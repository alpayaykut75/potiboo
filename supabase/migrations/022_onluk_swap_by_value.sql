-- Onluk: yer değiştir = değer bazlı (5 ile 6), index değil

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
  v_a text;
  v_b text;
  v_out jsonb := '[]'::jsonb;
  v_k int;
  v_n int;
begin
  select coalesce(array_agg(x order by ord), array[]::text[])
  into v_arr
  from jsonb_array_elements_text(p_seq) with ordinality as t(x, ord);

  v_n := coalesce(array_length(v_arr, 1), 0);

  if v_type = 'swap' then
    v_a := public.onluk_normalize(coalesce(p_rule->>'a', ''));
    v_b := public.onluk_normalize(coalesce(p_rule->>'b', ''));

    -- Eski format: i/j index
    if (v_a = '' or v_b = '') and p_rule ? 'i' and p_rule ? 'j' then
      v_i := (p_rule->>'i')::int;
      v_j := (p_rule->>'j')::int;
      if v_i is null or v_j is null
         or v_i < 0 or v_j < 0
         or v_i >= v_n or v_j >= v_n
         or v_i = v_j then
        raise exception 'Geçersiz yer değiştirme';
      end if;
    else
      if v_a = '' or v_b = '' or v_a = v_b then
        raise exception 'Geçersiz yer değiştirme';
      end if;
      v_i := null;
      v_j := null;
      for v_k in 1..v_n loop
        if v_i is null and public.onluk_normalize(v_arr[v_k]) = v_a then
          v_i := v_k - 1;
        elsif v_j is null and public.onluk_normalize(v_arr[v_k]) = v_b then
          v_j := v_k - 1;
        end if;
      end loop;
      if v_i is null or v_j is null or v_i = v_j then
        raise exception 'Geçersiz yer değiştirme';
      end if;
    end if;

    v_tmp := v_arr[v_i + 1];
    v_arr[v_i + 1] := v_arr[v_j + 1];
    v_arr[v_j + 1] := v_tmp;

  elsif v_type = 'rename' then
    v_i := (p_rule->>'index')::int;
    v_token := public.onluk_normalize(p_rule->>'token');
    if v_token is null or v_token = '' or char_length(v_token) > 12 then
      raise exception 'Geçersiz kelime';
    end if;
    if v_i is null or v_i < 0 or v_i >= v_n then
      raise exception 'Geçersiz konum';
    end if;
    if public.onluk_normalize(v_arr[v_i + 1]) = v_token then
      raise exception 'Aynı değer';
    end if;
    v_arr[v_i + 1] := v_token;

  elsif v_type = 'skip' then
    v_i := (p_rule->>'index')::int;
    if v_i is null or v_i < 0 or v_i >= v_n then
      raise exception 'Geçersiz konum';
    end if;
    if v_n <= 2 then
      raise exception 'Daha fazla atlanamaz';
    end if;
    v_arr := coalesce(v_arr[1:v_i], array[]::text[])
      || coalesce(v_arr[v_i + 2:v_n], array[]::text[]);

  elsif v_type = 'reverse' then
    select coalesce(array_agg(x order by ord desc), array[]::text[])
    into v_arr
    from unnest(v_arr) with ordinality as t(x, ord);

  else
    raise exception 'Bilinmeyen kural';
  end if;

  v_out := '[]'::jsonb;
  for v_k in 1..coalesce(array_length(v_arr, 1), 0) loop
    v_out := v_out || to_jsonb(v_arr[v_k]);
  end loop;
  return v_out;
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
  v_type text;
  v_a text;
  v_b text;
  v_event jsonb;
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

  v_type := p_rule->>'type';
  if v_type = 'swap' then
    v_a := coalesce(nullif(p_rule->>'a', ''), g.sequence->>(p_rule->>'i'));
    v_b := coalesce(nullif(p_rule->>'b', ''), g.sequence->>(p_rule->>'j'));
    v_event := jsonb_build_object(
      'kind', 'rule', 'by', auth.uid(),
      'rule', jsonb_build_object('type', 'swap', 'a', v_a, 'b', v_b),
      'a', v_a, 'b', v_b
    );
    p_rule := jsonb_build_object('type', 'swap', 'a', v_a, 'b', v_b);
  elsif v_type = 'rename' then
    v_a := g.sequence->>(p_rule->>'index')::int;
    v_b := public.onluk_normalize(p_rule->>'token');
    v_event := jsonb_build_object(
      'kind', 'rule', 'by', auth.uid(), 'rule', p_rule,
      'a', v_a, 'b', v_b
    );
  elsif v_type = 'skip' then
    v_a := g.sequence->>(p_rule->>'index')::int;
    v_event := jsonb_build_object(
      'kind', 'rule', 'by', auth.uid(), 'rule', p_rule,
      'a', v_a
    );
  else
    v_event := jsonb_build_object(
      'kind', 'rule', 'by', auth.uid(), 'rule', p_rule
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
    phase = 'reveal',
    turn_profile_id = v_count_turn,
    rule_turn_profile_id = v_next_rule_turn,
    ack_a = false,
    ack_b = false,
    deadline_at = now() + interval '2 minutes',
    last_event = v_event,
    updated_at = now()
  where room_id = p_room_id
  returning * into g;
  return g;
end;
$$;
