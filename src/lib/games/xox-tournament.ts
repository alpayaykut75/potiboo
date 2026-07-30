export type XoxTournamentPhase =
  | "intro"
  | "playing"
  | "intermission"
  | "finished";

export type XoxTournamentMatch = {
  key: string;
  side: "left" | "right" | "center";
  round: "qf" | "sf" | "final";
  player_a: string | null;
  player_b: string | null;
  winner: string | null;
  feeds: string | null;
  feed_slot: "a" | "b" | null;
};

export type XoxTournamentBracket = {
  order: string[];
  matches: Record<string, XoxTournamentMatch>;
};

export type XoxTournamentRow = {
  room_id: string;
  size: 4 | 8;
  phase: XoxTournamentPhase;
  current_match_key: string | null;
  bracket: XoxTournamentBracket;
  champion_id: string | null;
  updated_at: string;
};

export function parseXoxTournamentMatch(
  raw: unknown,
): XoxTournamentMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const key = typeof m.key === "string" ? m.key : "";
  if (!key) return null;
  const side =
    m.side === "left" || m.side === "right" || m.side === "center"
      ? m.side
      : "center";
  const round =
    m.round === "qf" || m.round === "sf" || m.round === "final"
      ? m.round
      : "sf";
  return {
    key,
    side,
    round,
    player_a: typeof m.player_a === "string" ? m.player_a : null,
    player_b: typeof m.player_b === "string" ? m.player_b : null,
    winner: typeof m.winner === "string" ? m.winner : null,
    feeds: typeof m.feeds === "string" ? m.feeds : null,
    feed_slot: m.feed_slot === "a" || m.feed_slot === "b" ? m.feed_slot : null,
  };
}

export function parseXoxTournamentBracket(
  raw: unknown,
): XoxTournamentBracket {
  if (!raw || typeof raw !== "object") {
    return { order: [], matches: {} };
  }
  const b = raw as Record<string, unknown>;
  const order = Array.isArray(b.order)
    ? b.order.filter((x): x is string => typeof x === "string")
    : [];
  const matches: Record<string, XoxTournamentMatch> = {};
  if (b.matches && typeof b.matches === "object" && !Array.isArray(b.matches)) {
    for (const [k, v] of Object.entries(
      b.matches as Record<string, unknown>,
    )) {
      const parsed = parseXoxTournamentMatch(v);
      if (parsed) matches[k] = parsed;
    }
  }
  return { order, matches };
}

export function matchLabel(key: string): string {
  switch (key) {
    case "LQF1":
    case "LQF2":
    case "RQF1":
    case "RQF2":
      return "Çeyrek final";
    case "LSF":
    case "RSF":
      return "Yarı final";
    case "F":
      return "Final";
    default:
      return "Maç";
  }
}
