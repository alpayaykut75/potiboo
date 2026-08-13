-- Onluk: 1–10 say, kural biriktir (2 oyuncu)

alter table public.rooms drop constraint if exists rooms_game_type_check;
alter table public.rooms
  add constraint rooms_game_type_check
  check (game_type in (
    'isim_sehir',
    'xox',
    'synked',
    'wordle',
    'amiral',
    'tabu',
    'kizma_birader',
    'onluk'
  ));

create table if not exists public.onluk_games (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  player_a uuid not null references public.profiles(id),
  player_b uuid not null references public.profiles(id),
  score_a int not null default 0 check (score_a >= 0),
  score_b int not null default 0 check (score_b >= 0),
  phase text not null default 'counting'
    check (phase in ('counting', 'rule', 'match_end')),
  sequence jsonb not null default '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
  cursor int not null default 0,
  turn_profile_id uuid not null references public.profiles(id),
  rule_turn_profile_id uuid not null references public.profiles(id),
  rules jsonb not null default '[]'::jsonb,
  deadline_at timestamptz not null default (now() + interval '3 seconds'),
  last_event jsonb,
  winner_id uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.onluk_games enable row level security;

drop policy if exists "onluk_select_member" on public.onluk_games;
drop policy if exists "onluk_insert_host" on public.onluk_games;
drop policy if exists "onluk_update_member" on public.onluk_games;

create policy "onluk_select_member"
  on public.onluk_games for select to authenticated
  using (public.is_room_member(room_id));

create policy "onluk_insert_host"
  on public.onluk_games for insert to authenticated
  with check (public.is_room_host(room_id));

create policy "onluk_update_member"
  on public.onluk_games for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

do $$
begin
  alter publication supabase_realtime add table public.onluk_games;
exception
  when duplicate_object then null;
end $$;

create or replace function public.onluk_normalize(p_word text)
returns text
language sql
immutable
as $$
  select lower(trim(both from coalesce(p_word, '')));
$$;

create or replace function public.onluk_initial_sequence()
returns jsonb
language sql
immutable
as $$
  select '["1","2","3","4","5","6","7","8","9","10"]'::jsonb;
$$;

create or replace function public.onluk_apply_rule(p_seq jsonb, p_rule jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_type text := p_rule->>'type';
  v_arr text[];
  v_i int;
  v_j int;
  v_tmp text;
  v_token text;
  v_out jsonb := '[]'::jsonb;
  v_k int;
begin
  select coalesce(array_agg(x order by ord), array[]::text[])
  into v_arr
  from jsonb_array_elements_text(p_seq) with ordinality as t(x, ord);

  if v_type = 'swap' then
    v_i := (p_rule->>'i')::int;
    v_j := (p_rule->>'j')::int;
    if v_i is null or v_j is null
       or v_i < 0 or v_j < 0
       or v_i >= array_length(v_arr, 1)
       or v_j >= array_length(v_arr, 1)
       or v_i = v_j then
      raise exception 'Geçersiz yer değiştirme';
    end if;
    -- 0-based → 1-based
    v_tmp := v_arr[v_i + 1];
    v_arr[v_i + 1] := v_arr[v_j + 1];
    v_arr[v_j + 1] := v_tmp;

  elsif v_type = 'rename' then
    v_i := (p_rule->>'index')::int;
    v_token := public.onluk_normalize(p_rule->>'token');
    if v_token is null or v_token = '' or char_length(v_token) > 12 then
      raise exception 'Geçersiz kelime';
    end if;
    if v_i is null or v_i < 0 or v_i >= array_length(v_arr, 1) then
      raise exception 'Geçersiz konum';
    end if;
    if public.onluk_normalize(v_arr[v_i + 1]) = v_token then
      raise exception 'Aynı değer';
    end if;
    v_arr[v_i + 1] := v_token;

  elsif v_type = 'skip' then
    v_i := (p_rule->>'index')::int;
    if v_i is null or v_i < 0 or v_i >= coalesce(array_length(v_arr, 1), 0) then
      raise exception 'Geçersiz konum';
    end if;
    if coalesce(array_length(v_arr, 1), 0) <= 2 then
      raise exception 'Daha fazla atlanamaz';
    end if;
    v_arr := coalesce(v_arr[1:v_i], array[]::text[])
      || coalesce(v_arr[v_i + 2:array_length(v_arr, 1)], array[]::text[]);

  elsif v_type = 'reverse' then
    select coalesce(array_agg(x order by ord desc), array[]::text[])
    into v_arr
    from unnest(v_arr) with ordinality as t(x, ord);

  else
    raise exception 'Bilinmeyen kural';
  end if;

  for v_k in 1..coalesce(array_length(v_arr, 1), 0) loop
    v_out := v_out || to_jsonb(v_arr[v_k]);
  end loop;
  return v_out;
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
    deadline_at = now() + interval '3 seconds',
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

  v_len := jsonb_array_length(g.sequence);
  if g.cursor + 1 >= v_len then
    -- Tur tamam: kural fazı
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
    deadline_at = now() + interval '3 seconds',
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
    -- süre doldu: kural ekleyemedi → rakibe puan (sayma fail gibi)
    -- turn was rule adder; treat as their fault
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

  update public.onluk_games set
    sequence = v_seq,
    rules = v_rules,
    cursor = 0,
    phase = 'counting',
    turn_profile_id = v_count_turn,
    rule_turn_profile_id = v_next_rule_turn,
    deadline_at = now() + interval '3 seconds',
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

create or replace function public.onluk_timeout(p_room_id uuid)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
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

create or replace function public.onluk_rematch(p_room_id uuid)
returns public.onluk_games
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.onluk_games%rowtype;
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

  update public.onluk_games set
    score_a = 0,
    score_b = 0,
    phase = 'counting',
    sequence = public.onluk_initial_sequence(),
    cursor = 0,
    turn_profile_id = g.player_a,
    rule_turn_profile_id = g.player_b,
    rules = '[]'::jsonb,
    deadline_at = now() + interval '3 seconds',
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

grant execute on function public.onluk_play_token(uuid, text) to authenticated;
grant execute on function public.onluk_add_rule(uuid, jsonb) to authenticated;
grant execute on function public.onluk_timeout(uuid) to authenticated;
grant execute on function public.onluk_rematch(uuid) to authenticated;
grant execute on function public.onluk_normalize(text) to authenticated;
