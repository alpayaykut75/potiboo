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
  _roomId: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("stop_letter", {
    p_round_id: roundId,
    p_letter: letter,
  });
  if (error) {
    throw new Error(error.message || "Harf seçilemedi");
  }
}

/** Odadaki kilitli harfler — rounds.letter kaynağı */
export async function fetchUsedLetters(roomId: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rounds")
    .select("letter")
    .eq("room_id", roomId)
    .not("letter", "is", null);

  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => r.letter)
    .filter((l): l is string => typeof l === "string" && l.length > 0)
    .map((l) => l.toLocaleUpperCase("tr-TR"));
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
  categories?: readonly string[],
): Promise<void> {
  const userId = await requireUserId();
  const supabase = createClient();
  const cats =
    categories && categories.length > 0
      ? [...categories]
      : Object.keys(values);

  const rows = cats.map((category) => ({
    round_id: roundId,
    profile_id: userId,
    category,
    value: (values[category] ?? "").trim() || null,
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
  categories?: readonly string[],
): Promise<void> {
  await saveAnswers(roundId, values, categories);
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

  const settings = room.settings as RoomSettings;

  // Kendi cevaplarını kaydet (tüm kategoriler)
  await saveAnswers(round.id, myAnswers, settings.categories);

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

  const { error } = await supabase.rpc("apply_round_scores", {
    p_round_id: roundId,
    p_answer_scores: result.answers.map((a) => ({
      profile_id: a.profileId,
      category: a.category,
      score: a.score,
    })),
    p_player_scores: result.players.map((p) => ({
      profile_id: p.profileId,
      round_score: p.roundScore,
      speed_bonus: p.speedBonus,
      finish_rank: p.finishRank,
    })),
  });

  if (error) throw new Error(error.message);
}

/** Cevap içeriği parmak izi — sadece değer/iptal değişince yeniden puanla */
export function answersContentFingerprint(answers: AnswerRow[]): string {
  return answers
    .map(
      (a) =>
        `${a.profile_id}\t${a.category}\t${a.value ?? ""}\t${a.is_invalidated ? 1 : 0}`,
    )
    .sort()
    .join("|");
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
