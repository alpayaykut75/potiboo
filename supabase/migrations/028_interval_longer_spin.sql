-- Interval: spin suspense 5s → 8s (akış daha okunaklı)

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
  v_pot_before int;
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

  v_pot_before := g.pot;
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
      reveal_at = now() + interval '8 seconds',
      last_event = jsonb_build_object(
        'kind', 'hit',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'payout', v_payout,
        'pot_before', v_pot_before,
        'pot_after', v_pot
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
      reveal_at = now() + interval '8 seconds',
      last_event = jsonb_build_object(
        'kind', 'miss',
        'by', auth.uid(),
        'stake', v_amount,
        'drawn', v_tile,
        'lo', v_lo,
        'hi', v_hi,
        'pot_before', v_pot_before,
        'pot_after', v_pot
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
  end if;

  return g;
end;
$$;
