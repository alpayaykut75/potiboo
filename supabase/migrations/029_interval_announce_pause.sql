-- Pas + ante: reveal'da durur, kurucu Devam deyince akar

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
  v_pot_before int;
begin
  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  v_pot_before := g.pot;
  v_ante := public.interval_apply_ante(g.banks, g.seats, g.pot);
  g.banks := v_ante->'banks';
  g.pot := (v_ante->>'pot')::int;

  delete from public.interval_hands where room_id = p_room_id;

  perform public.interval_reset_deck(p_room_id);

  v_n := coalesce(array_length(g.seats, 1), 0);
  v_drawn := public.interval_draw_n(p_room_id, v_n * 2);

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

  -- Ante duyurusu: phase=reveal, kurucu Devam → turn
  update public.interval_games set
    banks = g.banks,
    pot = g.pot,
    phase = 'reveal',
    turn_index = 0,
    turn_profile_id = g.seats[1],
    hand_index = g.hand_index + 1,
    intent_amount = null,
    seen_tiles = '[]'::jsonb,
    reveal_at = now(),
    last_event = jsonb_build_object(
      'kind', 'ante',
      'per', 10,
      'from_pot', v_pot_before,
      'to_pot', g.pot,
      'hand', g.hand_index + 1
    ),
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  perform public.interval_publish_turn(p_room_id, g.turn_profile_id);

  select * into g from public.interval_games where room_id = p_room_id;

  update public.rooms
  set status = 'playing', current_round = g.hand_index
  where id = p_room_id;

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
    phase = 'reveal',
    intent_amount = null,
    reveal_at = now(),
    last_event = jsonb_build_object('kind', 'pass', 'by', auth.uid()),
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  return g;
end;
$$;

create or replace function public.interval_continue(p_room_id uuid)
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
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu';
  end if;

  select * into g from public.interval_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;

  if g.phase = 'match_start'
     or (
       g.phase = 'turn'
       and g.hand_index = 0
       and g.turn_profile_id is null
       and g.pot = 0
     ) then
    return public.interval_deal_hand(p_room_id);
  end if;

  if g.phase = 'reveal' then
    if g.reveal_at is not null and g.reveal_at > now() then
      raise exception 'Henüz açılmadı';
    end if;
    -- Ante duyurusundan sonra ilk sıraya geç (advance etme)
    if coalesce(g.last_event->>'kind', '') = 'ante' then
      update public.interval_games set
        phase = 'turn',
        reveal_at = null,
        updated_at = now()
      where room_id = p_room_id
      returning * into g;
      return g;
    end if;
    return public.interval_advance(p_room_id);
  end if;

  if g.phase = 'hand_end' then
    return public.interval_deal_hand(p_room_id);
  end if;

  raise exception 'Devam edilemez';
end;
$$;
