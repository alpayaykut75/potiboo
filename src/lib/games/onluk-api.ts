"use client";

import { createClient } from "@/lib/supabase/client";
import {
  parseOnlukLastEvent,
  parseOnlukPhase,
  parseOnlukRules,
  parseOnlukSequence,
  type OnlukGameRow,
  type OnlukRule,
} from "@/lib/games/onluk";

function mapRow(data: Record<string, unknown>): OnlukGameRow {
  return {
    room_id: String(data.room_id),
    player_a: String(data.player_a),
    player_b: String(data.player_b),
    score_a: typeof data.score_a === "number" ? data.score_a : 0,
    score_b: typeof data.score_b === "number" ? data.score_b : 0,
    phase: parseOnlukPhase(data.phase),
    sequence: parseOnlukSequence(data.sequence),
    cursor: typeof data.cursor === "number" ? data.cursor : 0,
    turn_profile_id: String(data.turn_profile_id),
    rule_turn_profile_id: String(data.rule_turn_profile_id),
    rules: parseOnlukRules(data.rules),
    ack_a: Boolean(data.ack_a),
    ack_b: Boolean(data.ack_b),
    deadline_at: String(data.deadline_at ?? ""),
    last_event: parseOnlukLastEvent(data.last_event),
    winner_id: data.winner_id ? String(data.winner_id) : null,
    updated_at: String(data.updated_at ?? ""),
  };
}

export async function fetchOnlukGame(
  roomId: string,
): Promise<OnlukGameRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("onluk_games")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function onlukPlayToken(
  roomId: string,
  token: string,
): Promise<OnlukGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("onluk_play_token", {
    p_room_id: roomId,
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function onlukAddRule(
  roomId: string,
  rule: OnlukRule,
): Promise<OnlukGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("onluk_add_rule", {
    p_room_id: roomId,
    p_rule: rule,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function onlukTimeout(roomId: string): Promise<OnlukGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("onluk_timeout", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function onlukRematch(roomId: string): Promise<OnlukGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("onluk_rematch", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function onlukAckRule(roomId: string): Promise<OnlukGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("onluk_ack_rule", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}
