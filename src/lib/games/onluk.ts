/** Onluk — 1–10 say, kural biriktir düellosu */

export const ONLUK_COUNT_OPTIONS = [3, 5, 7] as const;
export type OnlukCountSec = (typeof ONLUK_COUNT_OPTIONS)[number];
export const ONLUK_DEFAULT_COUNT_SEC: OnlukCountSec = 5;
export const ONLUK_RULE_MS = 30000;
export const ONLUK_WIN_SCORE = 3;
export const ONLUK_MIN_SEQUENCE = 2;
export const ONLUK_MAX_TOKEN_LEN = 12;

export function resolveOnlukCountSec(raw: unknown): OnlukCountSec {
  return raw === 3 || raw === 5 || raw === 7 ? raw : ONLUK_DEFAULT_COUNT_SEC;
}

export type OnlukPhase = "counting" | "rule" | "reveal" | "match_end";

export type OnlukRule =
  | { type: "swap"; i: number; j: number }
  | { type: "rename"; index: number; token: string }
  | { type: "skip"; index: number }
  | { type: "reverse" };

export type OnlukLastEvent =
  | { kind: "wrong"; by: string; expected: string; got: string }
  | { kind: "timeout"; by: string; expected: string }
  | {
      kind: "rule";
      by: string;
      rule: OnlukRule;
      a?: string;
      b?: string;
    }
  | { kind: "point"; scorer: string; scoreA: number; scoreB: number }
  | null;

export type OnlukGameRow = {
  room_id: string;
  player_a: string;
  player_b: string;
  score_a: number;
  score_b: number;
  phase: OnlukPhase;
  sequence: string[];
  cursor: number;
  turn_profile_id: string;
  rule_turn_profile_id: string;
  rules: OnlukRule[];
  ack_a: boolean;
  ack_b: boolean;
  deadline_at: string;
  last_event: OnlukLastEvent;
  winner_id: string | null;
  updated_at: string;
};

export function initialSequence(): string[] {
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
}

export function normalizeOnlukToken(raw: string): string {
  return raw.trim().toLocaleLowerCase("tr-TR");
}

export function validateToken(raw: string): string | null {
  const t = normalizeOnlukToken(raw);
  if (!t || t.length > ONLUK_MAX_TOKEN_LEN) return null;
  return t;
}

export function applyRule(sequence: string[], rule: OnlukRule): string[] {
  const next = [...sequence];
  switch (rule.type) {
    case "swap": {
      const { i, j } = rule;
      if (
        i < 0 ||
        j < 0 ||
        i >= next.length ||
        j >= next.length ||
        i === j
      ) {
        throw new Error("Geçersiz yer değiştirme");
      }
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    }
    case "rename": {
      const token = validateToken(rule.token);
      if (token == null) throw new Error("Geçersiz kelime");
      if (rule.index < 0 || rule.index >= next.length) {
        throw new Error("Geçersiz konum");
      }
      if (normalizeOnlukToken(next[rule.index]!) === token) {
        throw new Error("Aynı değer");
      }
      next[rule.index] = token;
      return next;
    }
    case "skip": {
      if (rule.index < 0 || rule.index >= next.length) {
        throw new Error("Geçersiz konum");
      }
      if (next.length <= ONLUK_MIN_SEQUENCE) {
        throw new Error("Daha fazla atlanamaz");
      }
      next.splice(rule.index, 1);
      return next;
    }
    case "reverse":
      return next.reverse();
    default:
      throw new Error("Bilinmeyen kural");
  }
}

export function applyRules(base: string[], rules: OnlukRule[]): string[] {
  return rules.reduce((seq, rule) => applyRule(seq, rule), [...base]);
}

export function expectedToken(sequence: string[], cursor: number): string {
  if (cursor < 0 || cursor >= sequence.length) {
    throw new Error("Geçersiz sıra");
  }
  return sequence[cursor]!;
}

export function tokensForChips(sequence: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of sequence) {
    const key = normalizeOnlukToken(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function parseOnlukPhase(raw: unknown): OnlukPhase {
  return raw === "rule" ||
    raw === "reveal" ||
    raw === "match_end" ||
    raw === "counting"
    ? raw
    : "counting";
}

export function parseOnlukRules(raw: unknown): OnlukRule[] {
  if (!Array.isArray(raw)) return [];
  const out: OnlukRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "swap") {
      if (typeof row.i === "number" && typeof row.j === "number") {
        out.push({ type: "swap", i: row.i, j: row.j });
      }
    } else if (row.type === "rename") {
      if (typeof row.index === "number" && typeof row.token === "string") {
        out.push({ type: "rename", index: row.index, token: row.token });
      }
    } else if (row.type === "skip") {
      if (typeof row.index === "number") {
        out.push({ type: "skip", index: row.index });
      }
    } else if (row.type === "reverse") {
      out.push({ type: "reverse" });
    }
  }
  return out;
}

export function parseOnlukSequence(raw: unknown): string[] {
  if (!Array.isArray(raw)) return initialSequence();
  return raw.map((x) => String(x));
}

export function parseOnlukLastEvent(raw: unknown): OnlukLastEvent {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === "wrong" && typeof row.by === "string") {
    return {
      kind: "wrong",
      by: row.by,
      expected: String(row.expected ?? ""),
      got: String(row.got ?? ""),
    };
  }
  if (row.kind === "timeout" && typeof row.by === "string") {
    return {
      kind: "timeout",
      by: row.by,
      expected: String(row.expected ?? ""),
    };
  }
  if (row.kind === "rule" && typeof row.by === "string") {
    const rules = parseOnlukRules([row.rule]);
    if (rules[0]) {
      return {
        kind: "rule",
        by: row.by,
        rule: rules[0],
        a: typeof row.a === "string" ? row.a : undefined,
        b: typeof row.b === "string" ? row.b : undefined,
      };
    }
  }
  if (
    row.kind === "point" &&
    typeof row.scorer === "string" &&
    typeof row.scoreA === "number" &&
    typeof row.scoreB === "number"
  ) {
    return {
      kind: "point",
      scorer: row.scorer,
      scoreA: row.scoreA,
      scoreB: row.scoreB,
    };
  }
  return null;
}

export function describeRule(rule: OnlukRule): string {
  switch (rule.type) {
    case "swap":
      return `swap:${rule.i}:${rule.j}`;
    case "rename":
      return `rename:${rule.index}:${rule.token}`;
    case "skip":
      return `skip:${rule.index}`;
    case "reverse":
      return "reverse";
  }
}
