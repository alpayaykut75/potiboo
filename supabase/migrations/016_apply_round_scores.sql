-- İsim Şehir: kurucu puanları güvenli yazar (RLS bypass) + toplamları yeniler

create or replace function public.apply_round_scores(
  p_round_id uuid,
  p_answer_scores jsonb,
  p_player_scores jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_item jsonb;
  v_profile_id uuid;
  v_category text;
  v_score int;
  v_round_score int;
  v_speed_bonus int;
  v_finish_rank int;
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;

  select room_id into v_room_id from public.rounds where id = p_round_id;
  if v_room_id is null then
    raise exception 'Tur yok';
  end if;
  if not public.is_room_host(v_room_id) then
    raise exception 'Sadece kurucu puanlayabilir';
  end if;

  -- Cevap puanları: satır yoksa null value ile oluştur
  for v_item in select * from jsonb_array_elements(coalesce(p_answer_scores, '[]'::jsonb))
  loop
    v_profile_id := (v_item->>'profile_id')::uuid;
    v_category := v_item->>'category';
    v_score := coalesce((v_item->>'score')::int, 0);

    insert into public.answers (round_id, profile_id, category, value, score)
    values (p_round_id, v_profile_id, v_category, null, v_score)
    on conflict (round_id, profile_id, category)
    do update set score = excluded.score;
  end loop;

  -- Oyuncu tur puanları
  for v_item in select * from jsonb_array_elements(coalesce(p_player_scores, '[]'::jsonb))
  loop
    v_profile_id := (v_item->>'profile_id')::uuid;
    v_round_score := coalesce((v_item->>'round_score')::int, 0);
    v_speed_bonus := coalesce((v_item->>'speed_bonus')::int, 0);
    v_finish_rank := nullif(v_item->>'finish_rank', '')::int;

    insert into public.round_players (
      round_id, profile_id, finish_rank, speed_bonus, round_score
    )
    values (
      p_round_id, v_profile_id, v_finish_rank, v_speed_bonus, v_round_score
    )
    on conflict (round_id, profile_id)
    do update set
      finish_rank = excluded.finish_rank,
      speed_bonus = excluded.speed_bonus,
      round_score = excluded.round_score;
  end loop;

  -- Oda toplamları: scoring + done turların round_score toplamı
  for v_profile_id in
    select profile_id from public.room_players where room_id = v_room_id
  loop
    select coalesce(sum(rp.round_score), 0) into v_total
    from public.round_players rp
    join public.rounds r on r.id = rp.round_id
    where r.room_id = v_room_id
      and r.phase in ('scoring', 'done')
      and rp.profile_id = v_profile_id;

    update public.room_players
    set total_score = v_total
    where room_id = v_room_id and profile_id = v_profile_id;
  end loop;
end;
$$;

revoke all on function public.apply_round_scores(uuid, jsonb, jsonb) from public;
grant execute on function public.apply_round_scores(uuid, jsonb, jsonb) to authenticated;
