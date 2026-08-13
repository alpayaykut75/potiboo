-- match_start veya takılı turn (sıra yok, el 0): ilk eli başlat

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
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
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
    return public.interval_advance(p_room_id);
  end if;

  if g.phase = 'hand_end' then
    return public.interval_deal_hand(p_room_id);
  end if;

  raise exception 'Devam edilemez';
end;
$$;
