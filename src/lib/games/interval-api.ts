"use client";

import { createClient } from "@/lib/supabase/client";
import {
  parseIntervalBanks,
  parseIntervalLastEvent,
  parseIntervalPhase,
  parseIntervalSeats,
  parseIntervalTile,
  parseIntervalTiles,
  type IntervalGameRow,
  type IntervalHandRow,
} from "@/lib/games/interval";

function mapGame(data: Record<string, unknown>): IntervalGameRow {
  return {
    room_id: String(data.room_id),
    seats: parseIntervalSeats(data.seats),
    banks: parseIntervalBanks(data.banks),
    pot: typeof data.pot === "number" ? data.pot : 0,
    phase: parseIntervalPhase(data.phase),
    turn_profile_id: data.turn_profile_id
      ? String(data.turn_profile_id)
      : null,
    turn_index: typeof data.turn_index === "number" ? data.turn_index : 0,
    hand_index: typeof data.hand_index === "number" ? data.hand_index : 0,
    hand_total: typeof data.hand_total === "number" ? data.hand_total : 5,
    intent_amount:
      typeof data.intent_amount === "number" ? data.intent_amount : null,
    seen_tiles: parseIntervalTiles(data.seen_tiles),
    last_event: parseIntervalLastEvent(data.last_event),
    winner_id: data.winner_id ? String(data.winner_id) : null,
    updated_at: String(data.updated_at ?? ""),
  };
}

function mapHand(data: Record<string, unknown>): IntervalHandRow | null {
  const c1 = parseIntervalTile(data.c1);
  const c2 = parseIntervalTile(data.c2);
  if (!c1 || !c2) return null;
  return {
    room_id: String(data.room_id),
    profile_id: String(data.profile_id),
    c1,
    c2,
  };
}

export async function fetchIntervalGame(
  roomId: string,
): Promise<IntervalGameRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interval_games")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapGame(data as Record<string, unknown>);
}

export async function fetchIntervalHand(
  roomId: string,
): Promise<IntervalHandRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interval_hands")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapHand(data as Record<string, unknown>);
}

export async function intervalPass(roomId: string): Promise<IntervalGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("interval_pass", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapGame(data as Record<string, unknown>);
}

export async function intervalIntend(
  roomId: string,
  amount: number,
): Promise<IntervalGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("interval_intend", {
    p_room_id: roomId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
  return mapGame(data as Record<string, unknown>);
}

export async function intervalBet(
  roomId: string,
  amount: number,
): Promise<IntervalGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("interval_bet", {
    p_room_id: roomId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
  return mapGame(data as Record<string, unknown>);
}

export async function intervalContinue(
  roomId: string,
): Promise<IntervalGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("interval_continue", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapGame(data as Record<string, unknown>);
}

export async function intervalRematch(roomId: string): Promise<IntervalGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("interval_rematch", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapGame(data as Record<string, unknown>);
}
