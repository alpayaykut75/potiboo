"use client";

import { createClient } from "@/lib/supabase/client";
import { GAME } from "@/lib/constants";
import { generatePin, normalizePin } from "@/lib/rooms/pin";
import {
  defaultSettings,
  type Room,
  type RoomPlayerWithProfile,
  type RoomSettings,
} from "@/lib/rooms/types";

async function requireUserId(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Oturum bulunamadı. Sayfayı yenile.");
  return id;
}

export async function createRoom(): Promise<Room> {
  const supabase = createClient();
  const userId = await requireUserId();
  const settings = defaultSettings();

  // PIN çakışması olursa birkaç kez dene
  for (let attempt = 0; attempt < 8; attempt++) {
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

    return room as Room;
  }

  throw new Error("PIN üretilemedi. Tekrar dene.");
}

export async function joinRoomByPin(rawPin: string): Promise<Room> {
  const supabase = createClient();
  const userId = await requireUserId();
  const pin = normalizePin(rawPin);

  if (pin.length < 4) {
    throw new Error("PIN 4 karakter olmalı.");
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("pin", pin)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!room) throw new Error("Oda bulunamadı. PIN'i kontrol et.");

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
      return room as Room;
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
    return room as Room;
  }

  const { data: joinOrder, error: orderErr } = await supabase.rpc(
    "next_join_order",
    { p_room_id: room.id },
  );

  if (orderErr) {
    throw new Error(orderErr.message);
  }

  if (typeof joinOrder === "number" && joinOrder > GAME.maxPlayers) {
    throw new Error("Oda dolu (en fazla 8 kişi).");
  }

  const { error: insertErr } = await supabase.from("room_players").insert({
    room_id: room.id,
    profile_id: userId,
    join_order: typeof joinOrder === "number" ? joinOrder : 1,
    is_connected: true,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return room as Room;
    }
    if (insertErr.message.includes("row-level security")) {
      throw new Error("Odaya katılınamadı. Oda dolu veya kilitli olabilir.");
    }
    throw new Error(insertErr.message);
  }

  return room as Room;
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Room | null;
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
  const players = await fetchRoomPlayers(roomId);
  if (players.length < GAME.minPlayers) {
    throw new Error(`En az ${GAME.minPlayers} oyuncu gerekli.`);
  }
  if (players.length > GAME.maxPlayers) {
    throw new Error(`En fazla ${GAME.maxPlayers} oyuncu.`);
  }

  const sorted = [...players].sort((a, b) => a.join_order - b.join_order);
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

  // Başka client aynı anda oluşturmuş olabilir
  if (roundErr && roundErr.code !== "23505") {
    throw new Error(roundErr.message);
  }
}
