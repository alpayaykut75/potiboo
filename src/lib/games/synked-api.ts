"use client";

import { createClient } from "@/lib/supabase/client";
import {
  parseSynkedHistory,
  parseSynkedPhase,
  type SynkedGameRow,
  type SynkedMatchRow,
  type SynkedPhase,
  type SynkedState,
} from "@/lib/games/synked";
import {
  parseSynkedRacePhase,
  type SynkedRaceRow,
} from "@/lib/games/synked-race";

function mapGame(
  data: Record<string, unknown>,
  myWord: string | null = null,
): SynkedGameRow {
  return {
    room_id: String(data.room_id),
    team_id: data.team_id === 1 ? 1 : 0,
    player_a: (data.player_a as string) ?? null,
    player_b: (data.player_b as string) ?? null,
    phase: parseSynkedPhase(data.phase),
    round: typeof data.round === "number" ? data.round : 0,
    word_a: (data.word_a as string) ?? null,
    word_b: (data.word_b as string) ?? null,
    history: parseSynkedHistory(data.history),
    ready_a: Boolean(data.ready_a),
    ready_b: Boolean(data.ready_b),
    updated_at: String(data.updated_at ?? ""),
    my_word: myWord,
  };
}

function mapMatch(data: Record<string, unknown>): SynkedMatchRow {
  const mode = data.mode === "teams" ? "teams" : "duel";
  const winner =
    data.winner_team === 0 || data.winner_team === 1 ? data.winner_team : null;
  return {
    room_id: String(data.room_id),
    mode,
    status: data.status === "finished" ? "finished" : "playing",
    winner_team: winner,
    team0_phase: parseSynkedPhase(data.team0_phase),
    team1_phase: parseSynkedPhase(data.team1_phase),
    team0_round: typeof data.team0_round === "number" ? data.team0_round : 0,
    team1_round: typeof data.team1_round === "number" ? data.team1_round : 0,
    updated_at: String(data.updated_at ?? ""),
  };
}

function mapRace(
  data: Record<string, unknown>,
  myWord: string | null = null,
): SynkedRaceRow {
  const winner =
    data.winner_team === 0 || data.winner_team === 1 ? data.winner_team : null;
  return {
    room_id: String(data.room_id),
    phase: parseSynkedRacePhase(data.phase),
    seed1: (data.seed1 as string) ?? null,
    seed2: (data.seed2 as string) ?? null,
    team0_a: (data.team0_a as string) ?? null,
    team0_b: (data.team0_b as string) ?? null,
    team1_a: (data.team1_a as string) ?? null,
    team1_b: (data.team1_b as string) ?? null,
    round: typeof data.round === "number" ? data.round : 1,
    live_t0a: typeof data.live_t0a === "string" ? data.live_t0a : "",
    live_t0b: typeof data.live_t0b === "string" ? data.live_t0b : "",
    live_t1a: typeof data.live_t1a === "string" ? data.live_t1a : "",
    live_t1b: typeof data.live_t1b === "string" ? data.live_t1b : "",
    ready_t0a: Boolean(data.ready_t0a),
    ready_t0b: Boolean(data.ready_t0b),
    ready_t1a: Boolean(data.ready_t1a),
    ready_t1b: Boolean(data.ready_t1b),
    winner_team: winner,
    updated_at: String(data.updated_at ?? ""),
    my_word: myWord,
  };
}

async function fetchRaceMyWord(
  roomId: string,
  round: number,
): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("synked_race_submissions")
    .select("word")
    .eq("room_id", roomId)
    .eq("profile_id", user.id)
    .eq("round", round)
    .maybeSingle();

  return data?.word ?? null;
}

async function fetchMySubmission(
  roomId: string,
  teamId: 0 | 1,
  phase: SynkedPhase,
  round: number,
): Promise<string | null> {
  if (phase === "won") return null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("synked_submissions")
    .select("word")
    .eq("room_id", roomId)
    .eq("team_id", teamId)
    .eq("profile_id", user.id)
    .eq("phase", phase)
    .eq("round", round)
    .maybeSingle();

  return data?.word ?? null;
}

export async function fetchSynkedState(roomId: string): Promise<SynkedState> {
  const supabase = createClient();
  const [matchRes, gameRes, raceRes] = await Promise.all([
    supabase.from("synked_matches").select("*").eq("room_id", roomId).maybeSingle(),
    supabase.from("synked_games").select("*").eq("room_id", roomId).maybeSingle(),
    supabase.from("synked_races").select("*").eq("room_id", roomId).maybeSingle(),
  ]);

  if (matchRes.error) throw new Error(matchRes.error.message);
  if (gameRes.error) throw new Error(gameRes.error.message);
  if (raceRes.error) throw new Error(raceRes.error.message);

  const race = raceRes.data
    ? mapRace(raceRes.data as Record<string, unknown>)
    : null;

  if (race) {
    const myWord =
      race.phase === "race"
        ? await fetchRaceMyWord(roomId, race.round)
        : null;
    return { match: null, game: null, race: { ...race, my_word: myWord } };
  }

  const match = matchRes.data
    ? mapMatch(matchRes.data as Record<string, unknown>)
    : null;

  if (!gameRes.data) {
    return { match, game: null, race: null };
  }

  const raw = gameRes.data as Record<string, unknown>;
  const phase = parseSynkedPhase(raw.phase);
  const round = typeof raw.round === "number" ? raw.round : 0;
  const teamId: 0 | 1 = raw.team_id === 1 ? 1 : 0;
  const myWord = await fetchMySubmission(roomId, teamId, phase, round);
  return { match, game: mapGame(raw, myWord), race: null };
}

/** @deprecated use fetchSynkedState */
export async function fetchSynkedGame(
  roomId: string,
): Promise<SynkedGameRow | null> {
  const state = await fetchSynkedState(roomId);
  return state.game;
}

export async function synkedSubmitWord(
  roomId: string,
  word: string,
): Promise<SynkedState> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("synked_submit_word", {
    p_room_id: roomId,
    p_word: word,
  });
  if (error) throw new Error(error.message);
  const row = mapGame(data as Record<string, unknown>);
  const myWord = await fetchMySubmission(
    roomId,
    row.team_id,
    row.phase,
    row.round,
  );
  const state = await fetchSynkedState(roomId);
  return {
    match: state.match,
    game: { ...row, my_word: myWord },
    race: null,
  };
}

export async function synkedRematch(roomId: string): Promise<SynkedState> {
  const supabase = createClient();
  const { error } = await supabase.rpc("synked_rematch", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return fetchSynkedState(roomId);
}

export async function synkedRaceStop(
  roomId: string,
  word: string,
): Promise<SynkedRaceRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("synked_race_stop", {
    p_room_id: roomId,
    p_word: word,
  });
  if (error) throw new Error(error.message);
  return mapRace(data as Record<string, unknown>);
}

export async function synkedRaceSubmitWord(
  roomId: string,
  word: string,
): Promise<SynkedRaceRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("synked_race_submit_word", {
    p_room_id: roomId,
    p_word: word,
  });
  if (error) throw new Error(error.message);
  const row = mapRace(data as Record<string, unknown>);
  const myWord =
    row.phase === "race" ? await fetchRaceMyWord(roomId, row.round) : null;
  return { ...row, my_word: myWord };
}

export async function synkedRaceRematch(roomId: string): Promise<SynkedRaceRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("synked_race_rematch", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapRace(data as Record<string, unknown>);
}
