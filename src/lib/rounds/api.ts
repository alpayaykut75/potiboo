"use client";

import { createClient } from "@/lib/supabase/client";
import { scoreRound } from "@/lib/game/scoring";
import type { Room, RoomPlayerWithProfile, RoomSettings } from "@/lib/rooms/types";
import type {
  AnswerRow,
  Round,
  RoundPlayerRow,
} from "@/lib/rounds/types";

async function requireUserId(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Oturum bulunamadı.");
  return id;
}

export async function fetchCurrentRound(
  roomId: string,
  roundNumber: number,
): Promise<Round | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rounds")
    .select("*")
    .eq("room_id", roomId)
    .eq("round_number", roundNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Round | null;
}

export async function fetchRoundAnswers(roundId: string): Promise<AnswerRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("round_id", roundId);
  if (error) throw new Error(error.message);
  return (data ?? []) as AnswerRow[];
}

export async function fetchRoundPlayers(
  roundId: string,
): Promise<RoundPlayerRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("round_players")
    .select("*")
    .eq("round_id", roundId);
  if (error) throw new Error(error.message);
  return (data ?? []) as RoundPlayerRow[];
}

function pickStopper(
  players: RoomPlayerWithProfile[],
  roundNumber: number,
): string {
  const sorted = [...players].sort((a, b) => a.join_order - b.join_order);
  const idx = (roundNumber - 1) % sorted.length;
  return sorted[idx].profile_id;
}

/** İlk tur veya sonraki tur oluştur */
export async function ensureRound(
  room: Room,
  players: RoomPlayerWithProfile[],
): Promise<Round> {
  const supabase = createClient();
  const roundNumber = room.current_round || 1;

  const existing = await fetchCurrentRound(room.id, roundNumber);
  if (existing) return existing;

  const stopperId = pickStopper(players, roundNumber);
  const { data, error } = await supabase
    .from("rounds")
    .insert({
      room_id: room.id,
      round_number: roundNumber,
      letter: null,
      stopper_id: stopperId,
      phase: "waiting",
      reveal_index: 0,
    })
    .select("*")
    .single();

  if (error) {
    // Yarış: başka client oluşturmuş olabilir
    const again = await fetchCurrentRound(room.id, roundNumber);
    if (again) return again;
    throw new Error(error.message);
  }

  return data as Round;
}

export async function beginSpinning(roundId: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("rounds")
    .update({ phase: "spinning" })
    .eq("id", roundId)
    .eq("phase", "waiting");
}

export async function stopLetter(
  roundId: string,
  letter: string,
  roomId: string,
): Promise<void> {
  const userId = await requireUserId();
  const supabase = createClient();

  const { data: round } = await supabase
    .from("rounds")
    .select("stopper_id, phase")
    .eq("id", roundId)
    .single();

  if (!round) throw new Error("Tur yok");
  if (round.stopper_id !== userId) throw new Error("Sıra sende değil");
  if (round.phase !== "waiting" && round.phase !== "spinning") {
    throw new Error("Harf artık seçilemez");
  }

  const L = letter.toLocaleUpperCase("tr-TR");

  const { data: room } = await supabase
    .from("rooms")
    .select("used_letters")
    .eq("id", roomId)
    .single();

  const used: string[] = room?.used_letters ?? [];
  if (used.includes(L)) {
    throw new Error("Bu harf bu oyunda çıktı. Tekrar DUR’a bas.");
  }

  const { error } = await supabase
    .from("rounds")
    .update({
      letter: L,
      phase: "countdown",
      started_at: new Date().toISOString(),
      reveal_index: 0,
    })
    .eq("id", roundId)
    .in("phase", ["waiting", "spinning"]);

  if (error) throw new Error(error.message);

  await supabase
    .from("rooms")
    .update({ used_letters: [...used, L] })
    .eq("id", roomId);
}

export async function beginWriting(roundId: string): Promise<boolean> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("rounds")
    .update({ phase: "writing", started_at: now })
    .eq("id", roundId)
    .eq("phase", "countdown")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function ensureRoundPlayerRows(
  roundId: string,
  playerIds: string[],
): Promise<void> {
  const supabase = createClient();
  const rows = playerIds.map((profile_id) => ({
    round_id: roundId,
    profile_id,
  }));
  const { error } = await supabase.from("round_players").upsert(rows, {
    onConflict: "round_id,profile_id",
    ignoreDuplicates: true,
  });
  if (error) console.warn("round_players upsert:", error.message);
}

export async function saveAnswers(
  roundId: string,
  values: Record<string, string>,
): Promise<void> {
  const userId = await requireUserId();
  const supabase = createClient();
  const rows = Object.entries(values).map(([category, value]) => ({
    round_id: roundId,
    profile_id: userId,
    category,
    value: value.trim() || null,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase.from("answers").upsert(rows, {
    onConflict: "round_id,profile_id,category",
  });
  if (error) throw new Error(error.message);
}

export async function markFinished(
  roundId: string,
  values: Record<string, string>,
): Promise<void> {
  await saveAnswers(roundId, values);
  const userId = await requireUserId();
  const supabase = createClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from("round_players").upsert(
    {
      round_id: roundId,
      profile_id: userId,
      finished_at: now,
    },
    { onConflict: "round_id,profile_id" },
  );
  if (error) throw new Error(error.message);
}

export async function tryFinalizeWriting(params: {
  round: Round;
  room: Room;
  players: RoomPlayerWithProfile[];
  myAnswers: Record<string, string>;
}): Promise<boolean> {
  const { round, room, players, myAnswers } = params;
  if (round.phase !== "writing") return false;

  // Kendi cevaplarını kaydet
  await saveAnswers(round.id, myAnswers);

  const supabase = createClient();
  const userId = await requireUserId();

  // Bitirmemişse finished_at koy (süre doldu)
  const { data: me } = await supabase
    .from("round_players")
    .select("finished_at")
    .eq("round_id", round.id)
    .eq("profile_id", userId)
    .maybeSingle();

  if (!me?.finished_at) {
    await supabase.from("round_players").upsert(
      {
        round_id: round.id,
        profile_id: userId,
        finished_at: new Date().toISOString(),
      },
      { onConflict: "round_id,profile_id" },
    );
  }

  const roundPlayers = await fetchRoundPlayers(round.id);
  const allDone = players.every((p) =>
    roundPlayers.some(
      (rp) => rp.profile_id === p.profile_id && rp.finished_at != null,
    ),
  );

  const settings = room.settings as RoomSettings;
  const started = round.started_at ? new Date(round.started_at).getTime() : 0;
  const timeUp =
    started > 0 && Date.now() >= started + settings.duration * 1000;

  if (!allDone && !timeUp) return false;

  // Faz kilidi — kategori açılışı 0'dan başlar
  const { data: locked } = await supabase
    .from("rounds")
    .update({
      phase: "scoring",
      ended_at: new Date().toISOString(),
      reveal_index: 0,
      reveal_started_at: new Date().toISOString(),
    })
    .eq("id", round.id)
    .eq("phase", "writing")
    .select("id")
    .maybeSingle();

  if (!locked) return false;

  // Puanlama: client'lar önce cevaplarını flush eder, sonra applyScores çağırır
  return true;
}

export async function applyScores(
  roundId: string,
  room: Room,
  players: RoomPlayerWithProfile[],
): Promise<void> {
  const supabase = createClient();
  const settings = room.settings as RoomSettings;
  const { data: round } = await supabase
    .from("rounds")
    .select("*")
    .eq("id", roundId)
    .single();
  if (!round?.letter) return;

  const answers = await fetchRoundAnswers(roundId);
  const roundPlayers = await fetchRoundPlayers(roundId);
  const playerIds = players.map((p) => p.profile_id);

  const result = scoreRound({
    letter: round.letter,
    categories: settings.categories,
    speedBonusEnabled: settings.speedBonus,
    playerIds,
    answers: answers.map((a) => ({
      profileId: a.profile_id,
      category: a.category,
      value: a.value,
      isInvalidated: a.is_invalidated,
    })),
    finishes: playerIds.map((id) => {
      const rp = roundPlayers.find((x) => x.profile_id === id);
      return { profileId: id, finishedAt: rp?.finished_at ?? null };
    }),
  });

  for (const a of result.answers) {
    const existing = answers.find(
      (x) => x.profile_id === a.profileId && x.category === a.category,
    );
    if (existing) {
      await supabase
        .from("answers")
        .update({ score: a.score })
        .eq("id", existing.id);
    } else {
      await supabase.from("answers").insert({
        round_id: roundId,
        profile_id: a.profileId,
        category: a.category,
        value: null,
        score: a.score,
      });
    }
  }

  for (const p of result.players) {
    await supabase.from("round_players").upsert(
      {
        round_id: roundId,
        profile_id: p.profileId,
        finish_rank: p.finishRank,
        speed_bonus: p.speedBonus,
        round_score: p.roundScore,
      },
      { onConflict: "round_id,profile_id" },
    );

    // total_score: önceki turlar + bu tur (yeniden hesap güvenli değil basit ekle)
    // Daha doğrusu: tüm round_players sum — şimdilik incremental
    const { data: rp } = await supabase
      .from("room_players")
      .select("total_score")
      .eq("room_id", room.id)
      .eq("profile_id", p.profileId)
      .single();

    // Bu tur skorunu eklemeden önce aynı tur için zaten eklenmiş olabilir
    // Basit yol: tüm bitmiş turların round_score toplamı
  }

  // Toplam puanları tur skorlarından yeniden hesapla
  await recalculateTotalScores(room.id, players.map((p) => p.profile_id));
}

async function recalculateTotalScores(
  roomId: string,
  playerIds: string[],
): Promise<void> {
  const supabase = createClient();
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id")
    .eq("room_id", roomId)
    .in("phase", ["scoring", "done"]);

  const roundIds = (rounds ?? []).map((r) => r.id);
  if (roundIds.length === 0) return;

  const { data: rps } = await supabase
    .from("round_players")
    .select("profile_id, round_score")
    .in("round_id", roundIds);

  const totals = new Map<string, number>();
  for (const id of playerIds) totals.set(id, 0);
  for (const row of rps ?? []) {
    totals.set(
      row.profile_id,
      (totals.get(row.profile_id) ?? 0) + (row.round_score ?? 0),
    );
  }

  for (const [profileId, total] of totals) {
    await supabase
      .from("room_players")
      .update({ total_score: total })
      .eq("room_id", roomId)
      .eq("profile_id", profileId);
  }
}

export async function advanceToNextRound(
  room: Room,
  players: RoomPlayerWithProfile[],
): Promise<"next" | "finished"> {
  const userId = await requireUserId();
  if (room.host_id !== userId) throw new Error("Sadece kurucu devam edebilir");

  const settings = room.settings as RoomSettings;
  const supabase = createClient();

  // Mevcut turu done yap
  const current = await fetchCurrentRound(room.id, room.current_round);
  if (current && current.phase === "scoring") {
    await supabase
      .from("rounds")
      .update({ phase: "done" })
      .eq("id", current.id);
  }

  if (room.current_round >= settings.roundCount) {
    await supabase
      .from("rooms")
      .update({ status: "finished" })
      .eq("id", room.id);
    return "finished";
  }

  const nextNum = room.current_round + 1;
  await supabase
    .from("rooms")
    .update({ current_round: nextNum })
    .eq("id", room.id);

  const stopperId = pickStopper(players, nextNum);
  await supabase.from("rounds").insert({
    room_id: room.id,
    round_number: nextNum,
    letter: null,
    stopper_id: stopperId,
    phase: "waiting",
    reveal_index: 0,
  });

  return "next";
}

/** Kurucu: sonraki kategori veya tur özeti. Aktif oylama varken engellenir. */
export async function advanceReveal(
  round: Round,
  room: Room,
): Promise<void> {
  const userId = await requireUserId();
  if (room.host_id !== userId) throw new Error("Sadece kurucu devam edebilir");
  if (round.phase !== "scoring") throw new Error("Açılış aşamasında değil");

  const settings = room.settings as RoomSettings;
  const supabase = createClient();

  // Bu turun cevaplarına bağlı aktif oylama var mı?
  const { data: answerIds } = await supabase
    .from("answers")
    .select("id")
    .eq("round_id", round.id);
  const ids = (answerIds ?? []).map((a) => a.id);
  if (ids.length > 0) {
    const { data: voting } = await supabase
      .from("objections")
      .select("id")
      .in("answer_id", ids)
      .eq("status", "voting")
      .limit(1);
    if (voting && voting.length > 0) {
      throw new Error("Önce açık itiraz oylaması bitsin.");
    }
  }

  const maxIndex = settings.categories.length; // = özet
  const next = Math.min((round.reveal_index ?? 0) + 1, maxIndex);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("rounds")
    .update({
      reveal_index: next,
      reveal_started_at: now,
    })
    .eq("id", round.id)
    .eq("phase", "scoring");

  if (error) throw new Error(error.message);
}
