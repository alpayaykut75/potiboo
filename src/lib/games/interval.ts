/** Interval — aralıkta çek, puan topla (para yok) */

export const INTERVAL_HAND_OPTIONS = [3, 5, 10] as const;
export type IntervalHandCount = (typeof INTERVAL_HAND_OPTIONS)[number];
export const INTERVAL_DEFAULT_HANDS: IntervalHandCount = 5;
export const INTERVAL_START_BANK = 100;
export const INTERVAL_ANTE = 10;
export const INTERVAL_SPIN_MS = 5000;

export const INTERVAL_COLORS = [
  { id: "cyan", hex: "#3d9dc4" },
  { id: "green", hex: "#3ecf8e" },
  { id: "red", hex: "#e85d5d" },
  { id: "gold", hex: "#e8b84a" },
  { id: "purple", hex: "#c47bb8" },
] as const;

export type IntervalColorId = (typeof INTERVAL_COLORS)[number]["id"];

export type IntervalTile = {
  value: number;
  color: IntervalColorId;
};

export type IntervalPhase =
  | "match_start"
  | "turn"
  | "reveal"
  | "hand_end"
  | "match_end";

export type IntervalLastEvent =
  | { kind: "pass"; by: string }
  | { kind: "intent"; by: string; amount: number }
  | {
      kind: "ante";
      per: number;
      from_pot: number;
      to_pot: number;
      hand: number;
    }
  | {
      kind: "hit";
      by: string;
      stake: number;
      drawn: IntervalTile;
      lo: number;
      hi: number;
      payout: number;
      pot_before: number;
      pot_after: number;
    }
  | {
      kind: "miss";
      by: string;
      stake: number;
      drawn: IntervalTile;
      lo: number;
      hi: number;
      pot_before: number;
      pot_after: number;
    }
  | { kind: "hand_end"; pot: number; hand: number }
  | { kind: "burn"; pot: number }
  | null;

export type IntervalBanks = Record<string, number>;

export type IntervalGameRow = {
  room_id: string;
  seats: string[];
  banks: IntervalBanks;
  pot: number;
  phase: IntervalPhase;
  turn_profile_id: string | null;
  turn_index: number;
  hand_index: number;
  hand_total: number;
  intent_amount: number | null;
  seen_tiles: IntervalTile[];
  public_c1: IntervalTile | null;
  public_c2: IntervalTile | null;
  reveal_at: string | null;
  last_event: IntervalLastEvent;
  winner_id: string | null;
  updated_at: string;
};

export type IntervalHandRow = {
  room_id: string;
  profile_id: string;
  c1: IntervalTile;
  c2: IntervalTile;
};

export function resolveIntervalHands(raw: unknown): IntervalHandCount {
  return raw === 3 || raw === 5 || raw === 10 ? raw : INTERVAL_DEFAULT_HANDS;
}

export function colorHex(id: IntervalColorId): string {
  return INTERVAL_COLORS.find((c) => c.id === id)?.hex ?? "#3d9dc4";
}

export function buildDeck(): IntervalTile[] {
  const deck: IntervalTile[] = [];
  for (const color of INTERVAL_COLORS) {
    for (let value = 1; value <= 10; value++) {
      deck.push({ value, color: color.id });
    }
  }
  return deck;
}

/** Fisher–Yates — tests / client preview only; live shuffle is in SQL */
export function shuffleDeck(deck: IntervalTile[], rng = Math.random): IntervalTile[] {
  const next = [...deck];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

export function rangeOf(
  a: IntervalTile,
  b: IntervalTile,
): { lo: number; hi: number } {
  return {
    lo: Math.min(a.value, b.value),
    hi: Math.max(a.value, b.value),
  };
}

/** Eşikler tutmaz; komşu sayılar → aralık yok */
export function canStake(lo: number, hi: number): boolean {
  return hi - lo > 1;
}

export function isInRange(drawn: IntervalTile, lo: number, hi: number): boolean {
  return drawn.value > lo && drawn.value < hi;
}

export function maxStake(pot: number, bank: number): number {
  return Math.max(0, Math.min(Math.floor(pot), Math.floor(bank)));
}

/** Pas dışı koy miktarları: 1, 5, 10, yarım, hepsi */
export function stakeOptions(pot: number, bank: number): number[] {
  const max = maxStake(pot, bank);
  if (max < 1) return [];
  const raw = [1, 5, 10, Math.floor(max / 2), max];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of raw) {
    if (n < 1 || n > max || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function applyAnte(
  banks: IntervalBanks,
  seats: string[],
  pot: number,
  ante = INTERVAL_ANTE,
): { banks: IntervalBanks; pot: number } {
  const next = { ...banks };
  let nextPot = pot;
  for (const id of seats) {
    const bank = next[id] ?? 0;
    const pay = Math.min(ante, Math.max(0, bank));
    next[id] = bank - pay;
    nextPot += pay;
  }
  return { banks: next, pot: nextPot };
}

export function applyPass(): { kind: "pass" } {
  return { kind: "pass" };
}

export function applyPlay(args: {
  banks: IntervalBanks;
  pot: number;
  playerId: string;
  stake: number;
  lo: number;
  hi: number;
  drawn: IntervalTile;
}): {
  banks: IntervalBanks;
  pot: number;
  event: Exclude<IntervalLastEvent, null>;
} {
  const { playerId, stake, lo, hi, drawn } = args;
  if (!canStake(lo, hi)) throw new Error("Aralık yok");
  const bank = args.banks[playerId] ?? 0;
  if (stake < 1 || stake > maxStake(args.pot, bank)) {
    throw new Error("Geçersiz miktar");
  }

  const pot_before = args.pot;
  const banks = { ...args.banks, [playerId]: bank - stake };
  let pot = args.pot + stake;

  if (isInRange(drawn, lo, hi)) {
    const payout = stake * 2;
    if (payout > pot) throw new Error("Orta yetersiz");
    pot -= payout;
    banks[playerId] = (banks[playerId] ?? 0) + payout;
    return {
      banks,
      pot,
      event: {
        kind: "hit",
        by: playerId,
        stake,
        drawn,
        lo,
        hi,
        payout,
        pot_before,
        pot_after: pot,
      },
    };
  }

  return {
    banks,
    pot,
    event: {
      kind: "miss",
      by: playerId,
      stake,
      drawn,
      lo,
      hi,
      pot_before,
      pot_after: pot,
    },
  };
}

export function leaders(banks: IntervalBanks, seats: string[]): string[] {
  let best = -Infinity;
  const ids: string[] = [];
  for (const id of seats) {
    const v = banks[id] ?? 0;
    if (v > best) {
      best = v;
      ids.length = 0;
      ids.push(id);
    } else if (v === best) {
      ids.push(id);
    }
  }
  return ids;
}

export function parseIntervalPhase(raw: unknown): IntervalPhase {
  return raw === "match_start" ||
    raw === "reveal" ||
    raw === "hand_end" ||
    raw === "match_end" ||
    raw === "turn"
    ? raw
    : "turn";
}

/** Ante + dağıtım öncesi: maç başı veya hatalı parse (turn + sıra yok) */
export function isIntervalPreHand(game: {
  phase: IntervalPhase;
  hand_index: number;
  turn_profile_id: string | null;
  pot: number;
  public_c1: IntervalTile | null;
}): boolean {
  if (game.phase === "match_start") return true;
  return (
    game.hand_index === 0 &&
    game.turn_profile_id == null &&
    game.pot === 0 &&
    game.public_c1 == null &&
    game.phase === "turn"
  );
}

export function parseIntervalTile(raw: unknown): IntervalTile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  const color = row.color;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10 ||
    typeof color !== "string" ||
    !INTERVAL_COLORS.some((c) => c.id === color)
  ) {
    return null;
  }
  return { value, color: color as IntervalColorId };
}

export function parseIntervalBanks(raw: unknown): IntervalBanks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: IntervalBanks = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = Math.floor(n);
  }
  return out;
}

export function parseIntervalSeats(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x));
}

export function parseIntervalTiles(raw: unknown): IntervalTile[] {
  if (!Array.isArray(raw)) return [];
  const out: IntervalTile[] = [];
  for (const item of raw) {
    const tile = parseIntervalTile(item);
    if (tile) out.push(tile);
  }
  return out;
}

export function parseIntervalLastEvent(raw: unknown): IntervalLastEvent {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === "pass" && typeof row.by === "string") {
    return { kind: "pass", by: row.by };
  }
  if (
    row.kind === "intent" &&
    typeof row.by === "string" &&
    typeof row.amount === "number"
  ) {
    return { kind: "intent", by: row.by, amount: row.amount };
  }
  if (
    row.kind === "ante" &&
    typeof row.per === "number" &&
    typeof row.from_pot === "number" &&
    typeof row.to_pot === "number" &&
    typeof row.hand === "number"
  ) {
    return {
      kind: "ante",
      per: row.per,
      from_pot: row.from_pot,
      to_pot: row.to_pot,
      hand: row.hand,
    };
  }
  if (
    (row.kind === "hit" || row.kind === "miss") &&
    typeof row.by === "string"
  ) {
    const drawn = parseIntervalTile(row.drawn);
    if (!drawn) return null;
    const stake = Number(row.stake);
    const lo = Number(row.lo);
    const hi = Number(row.hi);
    const pot_before = Number(row.pot_before ?? 0);
    const pot_after = Number(row.pot_after ?? 0);
    if (!Number.isFinite(stake) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
      return null;
    }
    if (row.kind === "hit") {
      const payout = Number(row.payout);
      if (!Number.isFinite(payout)) return null;
      return {
        kind: "hit",
        by: row.by,
        stake,
        drawn,
        lo,
        hi,
        payout,
        pot_before: Number.isFinite(pot_before) ? pot_before : 0,
        pot_after: Number.isFinite(pot_after) ? pot_after : 0,
      };
    }
    return {
      kind: "miss",
      by: row.by,
      stake,
      drawn,
      lo,
      hi,
      pot_before: Number.isFinite(pot_before) ? pot_before : 0,
      pot_after: Number.isFinite(pot_after) ? pot_after : 0,
    };
  }
  if (
    row.kind === "hand_end" &&
    typeof row.pot === "number" &&
    typeof row.hand === "number"
  ) {
    return { kind: "hand_end", pot: row.pot, hand: row.hand };
  }
  if (row.kind === "burn" && typeof row.pot === "number") {
    return { kind: "burn", pot: row.pot };
  }
  return null;
}
