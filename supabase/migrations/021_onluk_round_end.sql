-- Onluk: tur kaybında geçiş ekranı (Anlaşıldı) + hata detayı

alter table public.onluk_games
  drop constraint if exists onluk_games_phase_check;

alter table public.onluk_games
  add constraint onluk_games_phase_check
  check (phase in ('counting', 'rule', 'reveal', 'round_end', 'match_end'));

create or replace function public.onluk_fail_round(
  p_room_id uuid,
  p_by uuid,
  p_kind text,
  p_expected text,
  p_got text
)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
  v_scorer uuid;
  v_score_a int;
  v_score_b int;
begin
  select * into g from public.onluk_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'counting' then
    raise exception 'Sayma fazında değil';
  end if;

  if p_by = g.player_a then
    v_scorer := g.player_b;
    v_score_a := g.score_a;
    v_score_b := g.score_b + 1;
  else
    v_scorer := g.player_a;
    v_score_a := g.score_a + 1;
    v_score_b := g.score_b;
  end if;

  if v_score_a >= 3 or v_score_b >= 3 then
    update public.onluk_games set
      score_a = v_score_a,
      score_b = v_score_b,
      phase = 'match_end',
      winner_id = v_scorer,
      ack_a = false,
      ack_b = false,
      last_event = jsonb_build_object(
        'kind', p_kind,
        'by', p_by,
        'expected', coalesce(p_expected, ''),
        'got', coalesce(p_got, ''),
        'scorer', v_scorer,
        'scoreA', v_score_a,
        'scoreB', v_score_b
      ),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  -- Sonraki tur hazır ama sayma başlamasın; önce hata ekranı
  update public.onluk_games set
    score_a = v_score_a,
    score_b = v_score_b,
    phase = 'round_end',
    sequence = public.onluk_initial_sequence(),
    cursor = 0,
    rules = '[]'::jsonb,
    turn_profile_id = v_scorer,
    rule_turn_profile_id = case
      when v_scorer = g.player_a then g.player_b
      else g.player_a
    end,
    ack_a = false,
    ack_b = false,
    deadline_at = now() + interval '2 minutes',
    last_event = jsonb_build_object(
      'kind', p_kind,
      'by', p_by,
      'expected', coalesce(p_expected, ''),
      'got', coalesce(p_got, ''),
      'scorer', v_scorer,
      'scoreA', v_score_a,
      'scoreB', v_score_b
    ),
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;

create or replace function public.onluk_ack_rule(p_room_id uuid)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
  v_count int;
  v_ack_a boolean;
  v_ack_b boolean;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.onluk_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase not in ('reveal', 'round_end') then
    raise exception 'Onay sırası değil';
  end if;

  v_ack_a := g.ack_a;
  v_ack_b := g.ack_b;
  if auth.uid() = g.player_a then
    v_ack_a := true;
  elsif auth.uid() = g.player_b then
    v_ack_b := true;
  else
    raise exception 'Oyuncu değilsin';
  end if;

  if v_ack_a and v_ack_b then
    v_count := public.onluk_count_seconds(p_room_id);
    update public.onluk_games set
      phase = 'counting',
      cursor = 0,
      ack_a = false,
      ack_b = false,
      deadline_at = now() + make_interval(secs => v_count),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  update public.onluk_games set
    ack_a = v_ack_a,
    ack_b = v_ack_b,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;

create or replace function public.onluk_timeout(p_room_id uuid)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli';
  end if;
  if not public.is_room_member(p_room_id) then
    raise exception 'Oda üyesi değilsin';
  end if;

  select * into g from public.onluk_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase = 'match_end' then
    return g;
  end if;
  if g.deadline_at >= now() then
    raise exception 'Süre dolmadı';
  end if;

  if g.phase in ('reveal', 'round_end') then
    v_count := public.onluk_count_seconds(p_room_id);
    update public.onluk_games set
      phase = 'counting',
      cursor = 0,
      ack_a = false,
      ack_b = false,
      deadline_at = now() + make_interval(secs => v_count),
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  if g.phase = 'rule' then
    update public.onluk_games set phase = 'counting', updated_at = now()
    where room_id = p_room_id;
    return public.onluk_fail_round(
      p_room_id, g.turn_profile_id, 'timeout', '', ''
    );
  end if;

  if g.phase = 'counting' then
    return public.onluk_fail_round(
      p_room_id,
      g.turn_profile_id,
      'timeout',
      public.onluk_normalize(g.sequence->>g.cursor),
      ''
    );
  end if;

  return g;
end;
$$;
