export type SynkedPhase = "seed" | "guess" | "won";
export type SynkedMode = "duel" | "teams";
export type SynkedMatchStatus = "playing" | "finished";

export type SynkedHistoryEntry = {
  a: string;
  b: string;
  kind: "seed" | "guess" | "match";
};

export type SynkedGameRow = {
  room_id: string;
  team_id: 0 | 1;
  player_a: string | null;
  player_b: string | null;
  phase: SynkedPhase;
  round: number;
  word_a: string | null;
  word_b: string | null;
  history: SynkedHistoryEntry[];
  ready_a: boolean;
  ready_b: boolean;
  updated_at: string;
  my_word: string | null;
};

export type SynkedMatchRow = {
  room_id: string;
  mode: SynkedMode;
  status: SynkedMatchStatus;
  winner_team: 0 | 1 | null;
  team0_phase: SynkedPhase;
  team1_phase: SynkedPhase;
  team0_round: number;
  team1_round: number;
  updated_at: string;
};

export type SynkedState = {
  match: SynkedMatchRow | null;
  game: SynkedGameRow | null;
};

export function normalizeSynkedWord(raw: string): string {
  return raw.trim().toLocaleLowerCase("tr-TR");
}

export function parseSynkedHistory(raw: unknown): SynkedHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SynkedHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const a = typeof row.a === "string" ? row.a : "";
    const b = typeof row.b === "string" ? row.b : "";
    const kind =
      row.kind === "seed" || row.kind === "guess" || row.kind === "match"
        ? row.kind
        : "guess";
    if (a || b) out.push({ a, b, kind });
  }
  return out;
}

export function parseSynkedPhase(raw: unknown): SynkedPhase {
  return raw === "guess" || raw === "won" || raw === "seed" ? raw : "seed";
}
