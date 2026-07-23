import { GAME } from "@/lib/constants";
import { normalizeAnswer, startsWithPoolLetter } from "@/lib/game/letters";

export type ScoreAnswerIn = {
  profileId: string;
  category: string;
  value: string | null;
  isInvalidated?: boolean;
};

export type ScoreFinishIn = {
  profileId: string;
  finishedAt: string | null;
};

export type ScoreAnswerOut = {
  profileId: string;
  category: string;
  score: number;
  valid: boolean;
};

export type ScorePlayerOut = {
  profileId: string;
  categoryScore: number;
  speedBonus: number;
  finishRank: number | null;
  roundScore: number;
  filledAll: boolean;
};

export type ScoreRoundResult = {
  answers: ScoreAnswerOut[];
  players: ScorePlayerOut[];
};

function isAnswerValid(
  value: string | null | undefined,
  letter: string,
  invalidated: boolean,
): boolean {
  if (invalidated) return false;
  if (value == null || value.trim() === "") return false;
  return startsWithPoolLetter(value, letter);
}

/**
 * Saf puanlama — her itiraz sonrası yeniden çalıştırılmalı.
 */
export function scoreRound(input: {
  letter: string;
  categories: string[];
  answers: ScoreAnswerIn[];
  finishes: ScoreFinishIn[];
  speedBonusEnabled: boolean;
  playerIds: string[];
}): ScoreRoundResult {
  const { letter, categories, speedBonusEnabled, playerIds } = input;

  const answerScores: ScoreAnswerOut[] = [];

  for (const category of categories) {
    const rows = playerIds.map((profileId) => {
      const found = input.answers.find(
        (a) => a.profileId === profileId && a.category === category,
      );
      return {
        profileId,
        value: found?.value ?? null,
        isInvalidated: found?.isInvalidated ?? false,
      };
    });

    const validNorms = new Map<string, number>();
    for (const row of rows) {
      if (!isAnswerValid(row.value, letter, row.isInvalidated)) continue;
      const key = normalizeAnswer(row.value!);
      validNorms.set(key, (validNorms.get(key) ?? 0) + 1);
    }

    for (const row of rows) {
      const valid = isAnswerValid(row.value, letter, row.isInvalidated);
      let score = 0;
      if (valid) {
        const key = normalizeAnswer(row.value!);
        const count = validNorms.get(key) ?? 0;
        score =
          count >= 2 ? GAME.sharedAnswerPoints : GAME.uniqueAnswerPoints;
      }
      answerScores.push({
        profileId: row.profileId,
        category,
        score,
        valid,
      });
    }
  }

  const categoryTotals = new Map<string, number>();
  for (const id of playerIds) categoryTotals.set(id, 0);
  for (const a of answerScores) {
    categoryTotals.set(
      a.profileId,
      (categoryTotals.get(a.profileId) ?? 0) + a.score,
    );
  }

  const filledAll = new Map<string, boolean>();
  for (const id of playerIds) {
    const allFilled = categories.every((category) => {
      const a = answerScores.find(
        (x) => x.profileId === id && x.category === category,
      );
      return a?.valid === true;
    });
    filledAll.set(id, allFilled);
  }

  const finishById = new Map(
    input.finishes.map((f) => [f.profileId, f.finishedAt]),
  );

  // Hız bonusu: yalnızca tüm kategorileri geçerli dolduranlar
  const eligible = playerIds
    .filter((id) => filledAll.get(id))
    .map((id) => ({
      profileId: id,
      finishedAt: finishById.get(id) ?? null,
    }))
    .filter((x) => x.finishedAt != null)
    .sort((a, b) => {
      const ta = new Date(a.finishedAt!).getTime();
      const tb = new Date(b.finishedAt!).getTime();
      return ta - tb;
    });

  const speedBonus = new Map<string, number>();
  const finishRank = new Map<string, number | null>();
  for (const id of playerIds) {
    speedBonus.set(id, 0);
    finishRank.set(id, null);
  }

  if (speedBonusEnabled) {
    eligible.forEach((e, index) => {
      const rank = index + 1;
      finishRank.set(e.profileId, rank);
      const bonus =
        rank <= GAME.speedBonusByRank.length
          ? GAME.speedBonusByRank[rank - 1]
          : 0;
      speedBonus.set(e.profileId, bonus);
    });
  } else {
    eligible.forEach((e, index) => {
      finishRank.set(e.profileId, index + 1);
    });
  }

  // Bitiren ama eligible olmayan (eksik) — rank yine kaydedilebilir
  const unfinishedRanked = playerIds
    .filter((id) => finishById.get(id) && finishRank.get(id) == null)
    .sort((a, b) => {
      const ta = new Date(finishById.get(a)!).getTime();
      const tb = new Date(finishById.get(b)!).getTime();
      return ta - tb;
    });
  let nextRank = eligible.length + 1;
  for (const id of unfinishedRanked) {
    finishRank.set(id, nextRank++);
  }

  const players: ScorePlayerOut[] = playerIds.map((profileId) => {
    const categoryScore = categoryTotals.get(profileId) ?? 0;
    const bonus = speedBonus.get(profileId) ?? 0;
    return {
      profileId,
      categoryScore,
      speedBonus: bonus,
      finishRank: finishRank.get(profileId) ?? null,
      roundScore: categoryScore + bonus,
      filledAll: filledAll.get(profileId) ?? false,
    };
  });

  return { answers: answerScores, players };
}
