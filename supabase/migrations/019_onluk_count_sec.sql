-- Onluk: sayma süresi oda ayarından (3 / 5 / 7 sn, varsayılan 5)

create or replace function public.onluk_count_seconds(p_room_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dur int;
begin
  select nullif(settings->>'duration', '')::int
  into v_dur
  from public.rooms
  where id = p_room_id;

  if v_dur in (3, 5, 7) then
    return v_dur;
  end if;
  return 5;
exception
  when others then
    return 5;
end;
$$;

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
  v_count int;
begin
  select * into g from public.onluk_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'counting' then
    raise exception 'Sayma fazında değil';
  end if;

  v_count := public.onluk_count_seconds(p_room_id);

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
      last_event = jsonb_build_object(
        'kind', p_kind,
        'by', p_by,
        'expected', p_expected,
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

  update public.onluk_games set
    score_a = v_score_a,
    score_b = v_score_b,
    phase = 'counting',
    sequence = public.onluk_initial_sequence(),
    cursor = 0,
    rules = '[]'::jsonb,
    turn_profile_id = v_scorer,
    rule_turn_profile_id = case
      when v_scorer = g.player_a then g.player_b
      else g.player_a
    end,
    deadline_at = now() + make_interval(secs => v_count),
    last_event = jsonb_build_object(
      'kind', p_kind,
      'by', p_by,
      'expected', p_expected,
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

create or replace function public.onluk_play_token(p_room_id uuid, p_token text)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
  v_expected text;
  v_got text;
  v_len int;
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
    raise exception 'Maç bitti';
  end if;
  if g.phase <> 'counting' then
    raise exception 'Sayma sırası değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;
  if g.deadline_at < now() then
    return public.onluk_fail_round(
      p_room_id, auth.uid(), 'timeout',
      public.onluk_normalize(g.sequence->>g.cursor), ''
    );
  end if;

  v_expected := public.onluk_normalize(g.sequence->>g.cursor);
  v_got := public.onluk_normalize(p_token);
  if v_got = '' or v_got is null then
    raise exception 'Geçersiz hamle';
  end if;

  if v_got is distinct from v_expected then
    return public.onluk_fail_round(
      p_room_id, auth.uid(), 'wrong', v_expected, v_got
    );
  end if;

  v_count := public.onluk_count_seconds(p_room_id);
  v_len := jsonb_array_length(g.sequence);
  if g.cursor + 1 >= v_len then
    update public.onluk_games set
      cursor = 0,
      phase = 'rule',
      turn_profile_id = g.rule_turn_profile_id,
      deadline_at = now() + interval '10 seconds',
      last_event = null,
      updated_at = now()
    where room_id = p_room_id
    returning * into g;
    return g;
  end if;

  update public.onluk_games set
    cursor = g.cursor + 1,
    turn_profile_id = case
      when auth.uid() = g.player_a then g.player_b
      else g.player_a
    end,
    deadline_at = now() + make_interval(secs => v_count),
    last_event = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;

create or replace function public.onluk_add_rule(p_room_id uuid, p_rule jsonb)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
  v_seq jsonb;
  v_rules jsonb;
  v_next_rule_turn uuid;
  v_count_turn uuid;
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
  if g.phase <> 'rule' then
    raise exception 'Kural sırası değil';
  end if;
  if g.turn_profile_id is distinct from auth.uid() then
    raise exception 'Sıra sende değil';
  end if;
  if g.deadline_at < now() then
    update public.onluk_games set phase = 'counting', updated_at = now()
    where room_id = p_room_id;
    return public.onluk_fail_round(
      p_room_id, auth.uid(), 'timeout', '', ''
    );
  end if;

  v_seq := public.onluk_apply_rule(g.sequence, p_rule);
  v_rules := g.rules || jsonb_build_array(p_rule);
  v_next_rule_turn := case
    when auth.uid() = g.player_a then g.player_b
    else g.player_a
  end;
  v_count_turn := v_next_rule_turn;
  v_count := public.onluk_count_seconds(p_room_id);

  update public.onluk_games set
    sequence = v_seq,
    rules = v_rules,
    cursor = 0,
    phase = 'counting',
    turn_profile_id = v_count_turn,
    rule_turn_profile_id = v_next_rule_turn,
    deadline_at = now() + make_interval(secs => v_count),
    last_event = jsonb_build_object(
      'kind', 'rule',
      'by', auth.uid(),
      'rule', p_rule
    ),
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;

create or replace function public.onluk_rematch(p_room_id uuid)
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
  if not public.is_room_host(p_room_id) then
    raise exception 'Sadece kurucu';
  end if;

  select * into g from public.onluk_games where room_id = p_room_id for update;
  if not found then
    raise exception 'Oyun yok';
  end if;
  if g.phase <> 'match_end' then
    raise exception 'Maç bitmedi';
  end if;

  v_count := public.onluk_count_seconds(p_room_id);

  update public.onluk_games set
    score_a = 0,
    score_b = 0,
    phase = 'counting',
    sequence = public.onluk_initial_sequence(),
    cursor = 0,
    turn_profile_id = g.player_a,
    rule_turn_profile_id = g.player_b,
    rules = '[]'::jsonb,
    deadline_at = now() + make_interval(secs => v_count),
    last_event = null,
    winner_id = null,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;

  update public.rooms set status = 'playing', current_round = 1
  where id = p_room_id;

  return g;
end;
$$;
