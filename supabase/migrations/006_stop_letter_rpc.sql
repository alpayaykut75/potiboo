-- Harf kilidi: DUR basan (stopper) host olmasa da used_letters yazabilsin.
-- Kaynak: rounds.letter + rooms.used_letters atomik güncelleme.

create or replace function public.stop_letter(p_round_id uuid, p_letter text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_stopper uuid;
  v_phase text;
  v_used text[];
  v_letter text;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;

  v_letter := upper(trim(p_letter));

  select room_id, stopper_id, phase
    into v_room_id, v_stopper, v_phase
  from public.rounds
  where id = p_round_id
  for update;

  if v_room_id is null then
    raise exception 'Tur yok';
  end if;

  if not public.is_room_member(v_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  if v_stopper is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;

  if v_phase not in ('waiting', 'spinning') then
    raise exception 'Harf artık seçilemez';
  end if;

  -- Bu odadaki tüm kilitli harfler (kaynak gerçek)
  select coalesce(array_agg(distinct upper(letter)), '{}'::text[])
    into v_used
  from public.rounds
  where room_id = v_room_id
    and letter is not null
    and length(trim(letter)) > 0;

  if v_letter = any (v_used) then
    raise exception 'Bu harf bu oyunda çıktı. Tekrar DUR’a bas.';
  end if;

  update public.rounds
  set
    letter = v_letter,
    phase = 'countdown',
    started_at = now(),
    reveal_index = 0
  where id = p_round_id
    and phase in ('waiting', 'spinning');

  if not found then
    raise exception 'Harf artık seçilemez';
  end if;

  update public.rooms
  set used_letters = v_used || v_letter
  where id = v_room_id;
end;
$$;

revoke all on function public.stop_letter(uuid, text) from public;
grant execute on function public.stop_letter(uuid, text) to authenticated;
