"use client";

import { createClient } from "@/lib/supabase/client";
import type { XoxBoardSize, XoxGameRow } from "@/lib/games/xox";
import { normalizeBoard, normalizeMarks } from "@/lib/games/xox";

function mapRow(data: Record<string, unknown>): XoxGameRow {
  const rawSize = data.board_size;
  const boardSize: XoxBoardSize =
    rawSize === 0 || rawSize === 5 || rawSize === 3 ? rawSize : 3;
  const winLength =
    typeof data.win_length === "number"
      ? data.win_length
      : boardSize === 0
        ? 5
        : boardSize === 5
          ? 4
          : 3;
  return {
    room_id: String(data.room_id),
    board: normalizeBoard(data.board as string[], boardSize),
    marks: normalizeMarks(data.marks),
    board_size: boardSize,
    win_length: winLength,
    next_mark: data.next_mark === "O" ? "O" : "X",
    x_player: (data.x_player as string) ?? null,
    o_player: (data.o_player as string) ?? null,
    status:
      data.status === "won" || data.status === "draw" ? data.status : "playing",
    winner_id: (data.winner_id as string) ?? null,
    updated_at: String(data.updated_at ?? ""),
  };
}

export async function fetchXoxGame(roomId: string): Promise<XoxGameRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("xox_games")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapRow(data);
}

export async function xoxMakeMove(
  roomId: string,
  row: number,
  col: number,
): Promise<XoxGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("xox_make_move", {
    p_room_id: roomId,
    p_row: row,
    p_col: col,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function xoxRematch(roomId: string): Promise<XoxGameRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("xox_rematch", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}
