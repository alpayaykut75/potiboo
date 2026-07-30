"use client";

import { createClient } from "@/lib/supabase/client";
import { ensureRemoteProfile } from "@/lib/profile/bootstrap";
import { generatePin, normalizePin } from "@/lib/rooms/pin";
import { PIN_LENGTH } from "@/lib/constants";
import {
  defaultSettings,
  type Room,
  type RoomPlayerWithProfile,
  type RoomSettings,
} from "@/lib/rooms/types";
import type { GameId } from "@/lib/games/catalog";
import { isGameId } from "@/lib/games/catalog";
import { gamePlayerLimits } from "@/lib/games/limits";
import { emptyXoxBoard, resolveXoxBoard } from "@/lib/games/xox";

export async function createRoom(
  gameType: GameId = "isim_sehir",
): Promise<Room> {
  const supabase = createClient();
  const userId = await ensureRemoteProfile();
  const settings = defaultSettings(gameType);

  // PIN çakışması olursa yeniden üret (benzersizlik garantisi)
  for (let attempt = 0; attempt < 16; attempt++) {
    const pin = generatePin();
    const { data: room, error } = await supabase
      .from("rooms")
      .insert({
        pin,
        host_id: userId,
        status: "lobby",
        settings,
        current_round: 0,
        used_letters: [],
        game_type: gameType,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") continue; // pin unique
      throw new Error(error.message);
    }

    const { error: playerErr } = await supabase.from("room_players").insert({
      room_id: room.id,
      profile_id: userId,
      join_order: 1,
      is_connected: true,
    });

    if (playerErr) {
      await supabase.from("rooms").delete().eq("id", room.id);
      throw new Error(playerErr.message);
    }

    return normalizeRoom(room);
  }

  throw new Error("PIN üretilemedi. Tekrar dene.");
}

function normalizeRoom(row: Record<string, unknown> | Room): Room {
  const gameType =
    typeof row.game_type === "string" && isGameId(row.game_type)
      ? row.game_type
      : "isim_sehir";
  return { ...(row as Room), game_type: gameType };
}

export async function joinRoomByPin(rawPin: string): Promise<Room> {
  const supabase = createClient();
  const userId = await ensureRemoteProfile();
  const pin = normalizePin(rawPin);

  if (pin.length !== PIN_LENGTH) {
    throw new Error("pin_wrong_length");
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("pin", pin)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!room) throw new Error("pin_not_found");

  if (room.status !== "lobby") {
    // Yeniden bağlanma: zaten üyeyse odaya dön
    const { data: existing } = await supabase
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("profile_id", userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("room_players")
        .update({ is_connected: true })
        .eq("id", existing.id);
      return normalizeRoom(room);
    }
    throw new Error("Oyun başlamış. Geç katılım yok.");
  }

  const { data: existing } = await supabase
    .from("room_players")
    .select("id")
    .eq("room_id", room.id)
    .eq("profile_id", userId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("room_players")
      .update({ is_connected: true })
      .eq("id", existing.id);
    return normalizeRoom(room);
  }

  const { data: joinOrder, error: orderErr } = await supabase.rpc(
    "next_join_order",
    { p_room_id: room.id },
  );

  if (orderErr) {
    throw new Error(orderErr.message);
  }

  if (typeof joinOrder === "number") {
    const limits = gamePlayerLimits(
      typeof room.game_type === "string" ? room.game_type : "isim_sehir",
    );
    if (joinOrder > limits.max) {
      throw new Error(`Oda dolu (en fazla ${limits.max} kişi).`);
    }
  }

  const { error: insertErr } = await supabase.from("room_players").insert({
    room_id: room.id,
    profile_id: userId,
    join_order: typeof joinOrder === "number" ? joinOrder : 1,
    is_connected: true,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return normalizeRoom(room);
    }
    if (insertErr.message.includes("row-level security")) {
      throw new Error("Odaya katılınamadı. Oda dolu veya kilitli olabilir.");
    }
    throw new Error(insertErr.message);
  }

  return normalizeRoom(room);
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeRoom(data);
}

export async function fetchRoomPlayers(
  roomId: string,
): Promise<RoomPlayerWithProfile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("room_players")
    .select(
      "id, room_id, profile_id, join_order, is_connected, total_score, joined_at, profiles(display_name, avatar_key)",
    )
    .eq("room_id", roomId)
    .order("join_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RoomPlayerWithProfile[];
}

/** Kurucu: oyuncuyu odadan çıkar */
export async function kickPlayer(
  roomId: string,
  profileId: string,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Oturum yok");

  const room = await fetchRoom(roomId);
  if (!room) throw new Error("Oda yok");
  if (room.host_id !== user.id) throw new Error("Sadece kurucu çıkarabilir");
  if (profileId === user.id) throw new Error("Kendini çıkaramazsın");

  const { error } = await supabase
    .from("room_players")
    .delete()
    .eq("room_id", roomId)
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

/** Oyuncu: odadan ayrıl */
export async function leaveRoom(roomId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Oturum yok");

  const { error } = await supabase
    .from("room_players")
    .delete()
    .eq("room_id", roomId)
    .eq("profile_id", user.id);
  if (error) throw new Error(error.message);
}

/** Kurucu: odayı kapat (herkes düşer) */
export async function closeRoom(roomId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Oturum yok");

  const room = await fetchRoom(roomId);
  if (!room) throw new Error("Oda yok");
  if (room.host_id !== user.id) throw new Error("Sadece kurucu kapatabilir");

  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) throw new Error(error.message);
}

export async function updateRoomSettings(
  roomId: string,
  settings: RoomSettings,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("rooms")
    .update({ settings })
    .eq("id", roomId);
  if (error) throw new Error(error.message);
}

export async function startGame(roomId: string): Promise<void> {
  const supabase = createClient();
  const room = await fetchRoom(roomId);
  if (!room) throw new Error("Oda yok");

  const players = await fetchRoomPlayers(roomId);
  const limits = gamePlayerLimits(room.game_type);

  if (players.length < limits.min) {
    throw new Error(`En az ${limits.min} oyuncu gerekli.`);
  }
  if (players.length > limits.max) {
    throw new Error(`En fazla ${limits.max} oyuncu.`);
  }

  const sorted = [...players].sort((a, b) => a.join_order - b.join_order);

  if (room.game_type === "xox") {
    const n = sorted.length;
    if (n !== 2 && n !== 4 && n !== 8) {
      throw new Error("XOX için 2, 4 veya 8 oyuncu gerekli.");
    }

    const { error } = await supabase
      .from("rooms")
      .update({ status: "playing", current_round: 1 })
      .eq("id", roomId)
      .eq("status", "lobby");
    if (error) throw new Error(error.message);

    if (n === 2) {
      const xPlayer = sorted[0]!.profile_id;
      const oPlayer = sorted[1]!.profile_id;
      const { boardSize, winLength } = resolveXoxBoard(room.settings);

      const { error: xoxErr } = await supabase.from("xox_games").upsert(
        {
          room_id: roomId,
          board: emptyXoxBoard(boardSize),
          marks: {},
          board_size: boardSize,
          win_length: winLength,
          next_mark: "X",
          x_player: xPlayer,
          o_player: oPlayer,
          status: "playing",
          winner_id: null,
        },
        { onConflict: "room_id" },
      );
      if (xoxErr) throw new Error(xoxErr.message);
      // Eski turnuva kalıntısı varsa temizle
      await supabase.from("xox_tournaments").delete().eq("room_id", roomId);
      return;
    }

    // 4 / 8 turnuva
    const { error: tourErr } = await supabase.rpc("xox_tournament_start", {
      p_room_id: roomId,
    });
    if (tourErr) throw new Error(tourErr.message);
    return;
  }

  if (room.game_type === "synked") {
    if (sorted.length !== 2 && sorted.length !== 4) {
      throw new Error("Synked için 2 veya 4 oyuncu gerekli.");
    }

    const { error } = await supabase
      .from("rooms")
      .update({ status: "playing", current_round: 1 })
      .eq("id", roomId)
      .eq("status", "lobby");
    if (error) throw new Error(error.message);

    if (sorted.length === 4) {
      // 4p yarış — eski klasik/takım satırlarını temizle
      await supabase.from("synked_games").delete().eq("room_id", roomId);
      await supabase.from("synked_matches").delete().eq("room_id", roomId);

      const { error: raceErr } = await supabase.from("synked_races").upsert(
        {
          room_id: roomId,
          phase: "spin1",
          seed1: null,
          seed2: null,
          team0_a: sorted[0]!.profile_id,
          team0_b: sorted[1]!.profile_id,
          team1_a: sorted[2]!.profile_id,
          team1_b: sorted[3]!.profile_id,
          live_t0a: "",
          live_t0b: "",
          live_t1a: "",
          live_t1b: "",
          winner_team: null,
        },
        { onConflict: "room_id" },
      );
      if (raceErr) throw new Error(raceErr.message);
      return;
    }

    // 2p klasik
    await supabase.from("synked_races").delete().eq("room_id", roomId);

    const { error: matchErr } = await supabase.from("synked_matches").upsert(
      {
        room_id: roomId,
        mode: "duel",
        status: "playing",
        winner_team: null,
        team0_phase: "seed",
        team1_phase: "seed",
        team0_round: 0,
        team1_round: 0,
      },
      { onConflict: "room_id" },
    );
    if (matchErr) throw new Error(matchErr.message);

    await supabase.from("synked_games").delete().eq("room_id", roomId);

    const { error: synkedErr } = await supabase.from("synked_games").insert({
      room_id: roomId,
      team_id: 0,
      player_a: sorted[0]!.profile_id,
      player_b: sorted[1]!.profile_id,
      phase: "seed",
      round: 0,
      word_a: null,
      word_b: null,
      history: [],
      ready_a: false,
      ready_b: false,
    });
    if (synkedErr) throw new Error(synkedErr.message);
    return;
  }

  // İsim Şehir
  const stopperId = sorted[0]?.profile_id;
  if (!stopperId) throw new Error("Oyuncu yok");

  const { error } = await supabase
    .from("rooms")
    .update({ status: "playing", current_round: 1 })
    .eq("id", roomId)
    .eq("status", "lobby");

  if (error) throw new Error(error.message);

  const { error: roundErr } = await supabase.from("rounds").insert({
    room_id: roomId,
    round_number: 1,
    letter: null,
    stopper_id: stopperId,
    phase: "waiting",
    reveal_index: 0,
  });

  if (roundErr && roundErr.code !== "23505") {
    throw new Error(roundErr.message);
  }
}
