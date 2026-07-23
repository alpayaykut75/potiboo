"use client";

import { createClient } from "@/lib/supabase/client";
import { GAME } from "@/lib/constants";
import { applyScores } from "@/lib/rounds/api";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import type { ObjectionRow, ObjectionVoteRow } from "@/lib/rounds/types";

async function requireUserId(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Oturum bulunamadı.");
  return id;
}

export async function fetchObjectionsForRound(
  roundId: string,
): Promise<ObjectionRow[]> {
  const supabase = createClient();
  const { data: answers } = await supabase
    .from("answers")
    .select("id")
    .eq("round_id", roundId);
  const ids = (answers ?? []).map((a) => a.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("objections")
    .select("*")
    .in("answer_id", ids)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ObjectionRow[];
}

export async function fetchVotes(
  objectionId: string,
): Promise<ObjectionVoteRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("objection_votes")
    .select("*")
    .eq("objection_id", objectionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ObjectionVoteRow[];
}

/** Kuyruktaki ilk voting itiraz (sıralı oylama) */
export function activeObjection(
  objections: ObjectionRow[],
): ObjectionRow | null {
  return objections.find((o) => o.status === "voting") ?? null;
}

/**
 * İtiraz eden = otomatik Yanlış.
 * İtiraz edilen oy kullanamaz.
 * Diğerleri oy verir; sessiz = Doğru.
 * Yanlış > Doğru → kelime düşer; eşitlik/çoğunluk Doğru → kalır.
 */
export function tallyObjectionVotes(params: {
  raisedBy: string;
  answerOwnerId: string;
  votes: ObjectionVoteRow[];
  players: RoomPlayerWithProfile[];
}): { dogru: number; yanlis: number; answerStaysValid: boolean } {
  const eligible = params.players.filter(
    (p) =>
      p.is_connected !== false &&
      p.profile_id !== params.raisedBy &&
      p.profile_id !== params.answerOwnerId,
  );

  let dogru = 0;
  let yanlis = 1; // itiraz eden otomatik Yanlış

  for (const p of eligible) {
    const vote = params.votes.find((v) => v.profile_id === p.profile_id);
    if (!vote || vote.is_valid) {
      dogru += 1; // sessiz veya Doğru
    } else {
      yanlis += 1;
    }
  }

  return {
    dogru,
    yanlis,
    answerStaysValid: dogru >= yanlis,
  };
}

export async function raiseObjection(params: {
  answerId: string;
  answerOwnerId: string;
  roundId: string;
  category: string;
  currentRevealCategory: string;
}): Promise<void> {
  const userId = await requireUserId();
  if (params.answerOwnerId === userId) {
    throw new Error("Kendi cevabına itiraz edemezsin.");
  }
  if (params.category !== params.currentRevealCategory) {
    throw new Error("Sadece açık kategoride itiraz edilebilir.");
  }

  const supabase = createClient();

  const { data: rp } = await supabase
    .from("round_players")
    .select("objections_used")
    .eq("round_id", params.roundId)
    .eq("profile_id", userId)
    .maybeSingle();

  const used = rp?.objections_used ?? 0;
  if (used >= GAME.objectionsPerRound) {
    throw new Error(`Tur başına en fazla ${GAME.objectionsPerRound} itiraz.`);
  }

  const { data: existing } = await supabase
    .from("objections")
    .select("id")
    .eq("answer_id", params.answerId)
    .limit(1);
  if (existing && existing.length > 0) {
    throw new Error("Bu cevaba zaten itiraz edildi.");
  }

  const { error } = await supabase.from("objections").insert({
    answer_id: params.answerId,
    raised_by: userId,
    status: "voting",
  });
  if (error) throw new Error(error.message);

  await supabase
    .from("round_players")
    .update({ objections_used: used + 1 })
    .eq("round_id", params.roundId)
    .eq("profile_id", userId);
}

export async function castVote(
  objectionId: string,
  isValid: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const supabase = createClient();

  const { data: obj } = await supabase
    .from("objections")
    .select("raised_by, status, answer_id")
    .eq("id", objectionId)
    .single();

  if (!obj || obj.status !== "voting") {
    throw new Error("Oylama kapalı.");
  }
  if (obj.raised_by === userId) {
    throw new Error("İtiraz eden oy kullanamaz.");
  }

  const { data: answer } = await supabase
    .from("answers")
    .select("profile_id")
    .eq("id", obj.answer_id)
    .single();

  if (answer?.profile_id === userId) {
    throw new Error("İtiraz edilen oyuncu oy kullanamaz.");
  }

  const { error } = await supabase.from("objection_votes").upsert(
    {
      objection_id: objectionId,
      profile_id: userId,
      is_valid: isValid,
    },
    { onConflict: "objection_id,profile_id" },
  );
  if (error) throw new Error(error.message);
}

export async function resolveObjection(params: {
  objection: ObjectionRow;
  room: Room;
  players: RoomPlayerWithProfile[];
  roundId: string;
}): Promise<"valid" | "invalid" | "noop"> {
  const supabase = createClient();

  const { data: current } = await supabase
    .from("objections")
    .select("*")
    .eq("id", params.objection.id)
    .single();

  if (!current || current.status !== "voting") return "noop";

  const { data: answer } = await supabase
    .from("answers")
    .select("profile_id")
    .eq("id", current.answer_id)
    .single();

  if (!answer) return "noop";

  const votes = await fetchVotes(params.objection.id);
  const { answerStaysValid } = tallyObjectionVotes({
    raisedBy: current.raised_by,
    answerOwnerId: answer.profile_id,
    votes,
    players: params.players,
  });

  const status = answerStaysValid ? "valid" : "invalid";

  const { data: updated } = await supabase
    .from("objections")
    .update({
      status,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", params.objection.id)
    .eq("status", "voting")
    .select("answer_id")
    .maybeSingle();

  if (!updated) return "noop";

  if (!answerStaysValid) {
    await supabase
      .from("answers")
      .update({ is_invalidated: true })
      .eq("id", updated.answer_id);
  }

  await applyScores(params.roundId, params.room, params.players);
  return status;
}

/** Süre doldu mu veya tüm uygun oyuncular oy verdi mi? */
export function shouldResolveObjection(
  objection: ObjectionRow,
  votes: ObjectionVoteRow[],
  players: RoomPlayerWithProfile[],
  answerOwnerId: string,
): boolean {
  const elapsed =
    (Date.now() - new Date(objection.created_at).getTime()) / 1000;
  if (elapsed >= GAME.objectionVoteSec) return true;

  const eligible = players.filter(
    (p) =>
      p.is_connected !== false &&
      p.profile_id !== objection.raised_by &&
      p.profile_id !== answerOwnerId,
  );
  if (eligible.length === 0) return true;

  const voted = eligible.filter((e) =>
    votes.some((v) => v.profile_id === e.profile_id),
  );
  return voted.length >= eligible.length;
}
