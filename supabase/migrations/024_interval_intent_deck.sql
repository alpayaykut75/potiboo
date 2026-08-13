-- Interval: niyet (koy miktarı), elde tekrar yok, görünen çekilen taşlar

alter table public.interval_games
  add column if not exists intent_amount int
    check (intent_amount is null or intent_amount > 0);

alter table public.interval_games
  add column if not exists seen_tiles jsonb not null default '[]'::jsonb;

alter table public.interval_secrets
  add column if not exists discard jsonb not null default '[]'::jsonb;

-- El içinde desteden çek; bitince discard'dan (eldeki taşlar karışmaz)
create or replace function public.interval_draw_n(p_room_id uuid, p_n int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck jsonb;
  v_discard jsonb;
  v_out jsonb := '[]'::jsonb;
  v_i int;
  v_tile jsonb;
begin
  if p_n < 1 then
    return '[]'::jsonb;
  end if;

  select deck, discard into v_deck, v_discard
  from public.interval_secrets
  where room_id = p_room_id
  for update;

  if v_deck is null then
    raise exception 'Deste yok';
  end if;

  v_discard := coalesce(v_discard, '[]'::jsonb);

  for v_i in 1..p_n loop
    -- El içinde yeniden karıştırma yok: çıkan taş (el veya çekilen) geri gelmez
    if coalesce(jsonb_array_length(v_deck), 0) < 1 then
      raise exception 'Deste bitti';
    end if;

    v_tile := v_deck->0;
    v_out := v_out || jsonb_build_array(v_tile);
    v_deck := v_deck - 0;
    v_discard := v_discard || jsonb_build_array(v_tile);
  end loop;

  update public.interval_secrets
  set deck = v_deck, discard = v_discard, updated_at = now()
  where room_id = p_room_id;

  return v_out;
end;
$$;

create or replace function public.interval_reset_deck(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.interval_secrets (room_id, deck, discard)
  values (
    p_room_id,
    public.interval_shuffle(public.interval_build_deck()),
    '[]'::jsonb
  )
  on conflict (room_id) do update
  set
    deck = excluded.deck,
    discard = '[]'::jsonb,
    updated_at = now();
end;
$$;

create or replace function public.interval_deal_hand(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_ante jsonb;
  v_drawn jsonb;
  v_id uuid;
  v_i int := 0;
  v_n int;
  v_c1 jsonb;
  v_c2 jsonb;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_ante := public.interval_apply_ante(g.banks, g.seats, g.pot);
  g.banks := v_ante->'banks';
  g.pot := (v_ante->>'pot')::int;

  delete from public.interval_hands where room_id = p_room_id;

  -- Her el taze 50 taş; önceki elin discard'ı karışmaz
  perform public.interval_reset_deck(p_room_id);

  v_n := coalesce(array_length(g.seats, 1), 0);
  v_drawn := public.interval_draw_n(p_room_id, v_n * 2);

  -- Deal edilenler discard'da kalmasın (gizli eller); sadece çekilenler seen olur
  update public.interval_secrets
  set discard = '[]'::jsonb, updated_at = now()
  where room_id = p_room_id;

  foreach v_id in array g.seats loop
    v_c1 := v_drawn->v_i;
    v_c2 := v_drawn->(v_i + 1);
    v_i := v_i + 2;
    insert into public.interval_hands (room_id, profile_id, c1, c2)
    values (p_room_id, v_id, v_c1, v_c2);
  end loop;

  update public.interval_games set
    banks = g.banks,
    pot = g.pot,
    phase = 'turn',
    turn_index = 0,
    turn_profile_id = g.seats[1],
    hand_index = g.hand_index + 1,
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    last_event = null,
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  update public.rooms
  set status = 'playing', current_round = g.hand_index
  where id = p_room_id;

  return g;
end;
$$;

create or replace function public.interval_advance(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_next int;
  v_len int;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_len := coalesce(array_length(g.seats, 1), 0);
  v_next := g.turn_index + 1;

  if v_next >= v_len then
    if g.hand_index >= g.hand_total then
      return public.interval_finish_match(p_room_id);
    end if;

    update public.interval_games set
      phase = 'hand_end',
      turn_profile_id = null,
      intent_amount = null,
      last_event = jsonb_build_object(
        'kind', 'hand_end',
        'pot', g.pot,
        'hand', g.hand_index
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  update public.interval_games set
    phase = 'turn',
    turn_index = v_next,
    turn_profile_id = g.seats[v_next + 1],
    intent_amount = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

create or replace function public.interval_intend(p_room_id uuid, p_amount int)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  h public.interval_hands%rowtype;
  v_lo int;
  v_hi int;
  v_bank int;
  v_max int;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'turn' then
    raise exception 'Sıra fazında değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  select * into h
  from public.interval_hands
  where room_id = p_room_id and profile_id = auth.uid();
  if not found then
    raise exception 'El yok';
  end if;

  v_lo := least((h.c1->>'value')::int, (h.c2->>'value')::int);
  v_hi := greatest((h.c1->>'value')::int, (h.c2->>'value')::int);
  if v_hi - v_lo <= 1 then
    raise exception 'Aralık yok — sadece pas';
  end if;

  v_bank := coalesce((g.banks->>auth.uid()::text)::int, 0);
  v_max := least(g.pot, v_bank);
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    raise exception 'Geçersiz miktar';
  end if;

  update public.interval_games set
    intent_amount = p_amount,
    last_event = jsonb_build_object(
      'kind', 'intent',
      'by', auth.uid(),
      'amount', p_amount
    ),
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

create or replace function public.interval_pass(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'turn' then
    raise exception 'Sıra fazında değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  update public.interval_games set
    intent_amount = null,
    last_event = jsonb_build_object('kind', 'pass', 'by', auth.uid()),
    updated_at = now()
  where room_id = p_room_id;

  return public.interval_advance(p_room_id);
end;
$$;

create or replace function public.interval_bet(p_room_id uuid, p_amount int)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  h public.interval_hands%rowtype;
  v_lo int;
  v_hi int;
  v_bank int;
  v_max int;
  v_amount int;
  v_drawn jsonb;
  v_tile jsonb;
  v_val int;
  v_payout int;
  v_pot int;
  v_banks jsonb;
  v_seen jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'turn' then
    raise exception 'Sıra fazında değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  select * into h
  from public.interval_hands
  where room_id = p_room_id and profile_id = auth.uid();
  if not found then
    raise exception 'El yok';
  end if;

  v_lo := least((h.c1->>'value')::int, (h.c2->>'value')::int);
  v_hi := greatest((h.c1->>'value')::int, (h.c2->>'value')::int);
  if v_hi - v_lo <= 1 then
    raise exception 'Aralık yok — sadece pas';
  end if;

  v_amount := coalesce(p_amount, g.intent_amount);
  v_bank := coalesce((g.banks->>auth.uid()::text)::int, 0);
  v_max := least(g.pot, v_bank);
  if v_amount is null or v_amount < 1 or v_amount > v_max then
    raise exception 'Geçersiz miktar';
  end if;

  v_drawn := public.interval_draw_n(p_room_id, 1);
  v_tile := v_drawn->0;
  v_val := (v_tile->>'value')::int;

  v_banks := g.banks;
  v_banks := jsonb_set(v_banks, array[auth.uid()::text], to_jsonb(v_bank - v_amount));
  v_pot := g.pot + v_amount;
  v_seen := coalesce(g.seen_tiles, '[]'::jsonb) || jsonb_build_array(v_tile);

  if v_val > v_lo and v_val < v_hi then
    v_payout := v_amount * 2;
    if v_payout > v_pot then
      raise exception 'Orta yetersiz';
    end if;
    v_pot := v_pot - v_payout;
    v_banks := jsonb_set(
      v_banks,
      array[auth.uid()::text],
      to_jsonb(coalesce((v_banks->>auth.uid()::text)::int, 0) + v_payout)
    );

    update public.interval_games set
      banks = v_banks,
      pot = v_pot,
      phase = 'reveal',
      intent_amount = null,
      seen_tiles = v_seen,
      last_event = jsonb_build_object(
        'kind', 'hit',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'payout', v_payout
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  else
    update public.interval_games set
      banks = v_banks,
      pot = v_pot,
      phase = 'reveal',
      intent_amount = null,
      seen_tiles = v_seen,
      last_event = jsonb_build_object(
        'kind', 'miss',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;

create or replace function public.interval_start(p_room_id uuid)
returns public.interval_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.interval_games%rowtype;
  v_seats uuid[];
  v_banks jsonb := '{}'::jsonb;
  v_id uuid;
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu';
  end if;

  select array_agg(profile_id order by join_order)
  into v_seats
  from public.room_players
  where room_id = p_room_id;

  if v_seats is null or coalesce(array_length(v_seats, 1), 0) < 2
     or coalesce(array_length(v_seats, 1), 0) > 8 then
    raise exception 'Interval için 2–8 oyuncu gerekli';
  end if;

  foreach v_id in array v_seats loop
    v_banks := jsonb_set(v_banks, array[v_id::text], '100'::jsonb);
  end loop;

  v_total := public.interval_hand_total(p_room_id);

  perform public.interval_reset_deck(p_room_id);

  insert into public.interval_games (
    room_id, seats, banks, pot, phase, turn_profile_id, turn_index,
    hand_index, hand_total, intent_amount, seen_tiles, last_event, winner_id
  ) values (
    p_room_id, v_seats, v_banks, 0, 'turn', null, 0,
    0, v_total, null, '[]'::jsonb, null, null
  )
  on conflict (room_id) do update set
    seats = excluded.seats,
    banks = excluded.banks,
    pot = 0,
    phase = 'turn',
    turn_profile_id = null,
    turn_index = 0,
    hand_index = 0,
    hand_total = excluded.hand_total,
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    last_event = null,
    winner_id = null,
    updated_at = now();

  update public.rooms
  set status = 'playing', current_round = 1
  where id = p_room_id;

  return public.interval_deal_hand(p_room_id);
end;
$$;

grant execute on function public.interval_intend(uuid, int) to authenticated;
