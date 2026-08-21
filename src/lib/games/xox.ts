import type { GameId } from "@/lib/games/catalog";

/** İsim Şehir ayarları */
export type IsımSehirSettings = {
  duration: number;
  roundCount: number;
  categories: string[];
  speedBonus: boolean;
};

/** 0 = sonsuz tahta */
export type XoxBoardSize = 0 | 3 | 5;

/** Seri uzunluğu (maç sayısı) */
export type XoxSeriesLength = 1 | 3 | 5;

export const XOX_SERIES_OPTIONS: XoxSeriesLength[] = [1, 3, 5];
export const XOX_DEFAULT_SERIES: XoxSeriesLength = 3;
/** Sonsuz tahta hamle tavanı (iki oyuncu toplam) */
export const XOX_INFINITE_MOVE_LIMIT = 60;

/** XOX / Toxxo ayarları */
export type XoxSettings = {
  boardSize: XoxBoardSize;
  winLength: number;
  seriesLength: XoxSeriesLength;
};

export type RoomSettings = IsımSehirSettings & Partial<XoxSettings>;

export function defaultWinLength(boardSize: XoxBoardSize): number {
  if (boardSize === 0) return 5;
  if (boardSize === 5) return 4;
  return 3;
}

export function resolveXoxSeriesLength(
  raw: unknown,
): XoxSeriesLength {
  return raw === 1 || raw === 3 || raw === 5 ? raw : XOX_DEFAULT_SERIES;
}

/** Seriyi kazanmak için gereken puan */
export function xoxSeriesTarget(seriesLength: XoxSeriesLength): number {
  if (seriesLength === 1) return 1;
  if (seriesLength === 5) return 3;
  return 2;
}

export function formatXoxScore(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

export function emptyXoxBoard(boardSize: XoxBoardSize): string[] {
  if (boardSize === 0) return [];
  return Array(boardSize * boardSize).fill("");
}

export function resolveXoxBoard(
  settings: Partial<XoxSettings> | null | undefined,
  opts?: { tournamentDefault?: boolean },
): { boardSize: XoxBoardSize; winLength: number } {
  const raw = settings?.boardSize;
  const fallback: XoxBoardSize = opts?.tournamentDefault ? 5 : 3;
  const boardSize: XoxBoardSize =
    raw === 0 || raw === 5 || raw === 3 ? raw : fallback;
  const maxWin = boardSize === 0 ? 5 : boardSize;
  const winLength =
    typeof settings?.winLength === "number" &&
    settings.winLength >= 3 &&
    settings.winLength <= maxWin
      ? settings.winLength
      : defaultWinLength(boardSize);
  return { boardSize, winLength };
}

export function xoxBoardLabel(boardSize: XoxBoardSize): string {
  if (boardSize === 0) return "Sonsuz";
  return `${boardSize}×${boardSize}`;
}

export function defaultSettingsFor(gameType: GameId): RoomSettings {
  if (gameType === "xox") {
    return {
      duration: 60,
      roundCount: 1,
      categories: [],
      speedBonus: false,
      boardSize: 3,
      winLength: 3,
      seriesLength: XOX_DEFAULT_SERIES,
    };
  }
  if (gameType === "synked") {
    return {
      duration: 60,
      roundCount: 1,
      categories: [],
      speedBonus: false,
    };
  }
  if (gameType === "onluk") {
    return {
      duration: 5,
      roundCount: 1,
      categories: [],
      speedBonus: false,
    };
  }
  if (gameType === "interval") {
    return {
      duration: 60,
      roundCount: 5,
      categories: [],
      speedBonus: false,
    };
  }
  return {
    duration: 60,
    roundCount: 5,
    categories: ["İsim", "Şehir", "Hayvan", "Bitki", "Eşya"],
    speedBonus: true,
  };
}

export type XoxMark = "X" | "O" | "";

export type XoxMarks = Record<string, "X" | "O">;

export type XoxScores = Record<string, number>;

export type XoxGameRow = {
  room_id: string;
  board: string[];
  marks: XoxMarks;
  board_size: XoxBoardSize;
  win_length: number;
  next_mark: "X" | "O";
  x_player: string | null;
  o_player: string | null;
  status: "playing" | "won" | "draw";
  winner_id: string | null;
  series_length: XoxSeriesLength;
  match_index: number;
  scores: XoxScores;
  move_count: number;
  updated_at: string;
};

export function normalizeXoxScores(raw: unknown): XoxScores {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: XoxScores = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function markKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function normalizeBoard(
  board: string[] | null | undefined,
  boardSize: XoxBoardSize = 3,
): XoxMark[] {
  if (boardSize === 0) return [];
  const n = boardSize * boardSize;
  const raw = board ?? [];
  const out: XoxMark[] = [];
  for (let i = 0; i < n; i++) {
    const c = raw[i];
    out.push(c === "X" || c === "O" ? c : "");
  }
  return out;
}

export function normalizeMarks(raw: unknown): XoxMarks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: XoxMarks = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "X" || v === "O") out[k] = v;
  }
  return out;
}

/** Sonsuz tahta görünür penceresi — taşların etrafında pad */
export function infiniteViewport(
  marks: XoxMarks,
  pad = 2,
  emptySpan = 3,
  maxSpan = 13,
): { minR: number; maxR: number; minC: number; maxC: number } {
  const keys = Object.keys(marks);
  if (keys.length === 0) {
    return {
      minR: -emptySpan,
      maxR: emptySpan,
      minC: -emptySpan,
      maxC: emptySpan,
    };
  }

  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const k of keys) {
    const [rs, cs] = k.split(",");
    const r = Number(rs);
    const c = Number(cs);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }

  minR -= pad;
  maxR += pad;
  minC -= pad;
  maxC += pad;

  // Çok büyürse ortaya kırp
  if (maxR - minR + 1 > maxSpan) {
    const mid = Math.floor((minR + maxR) / 2);
    minR = mid - Math.floor(maxSpan / 2);
    maxR = minR + maxSpan - 1;
  }
  if (maxC - minC + 1 > maxSpan) {
    const mid = Math.floor((minC + maxC) / 2);
    minC = mid - Math.floor(maxSpan / 2);
    maxC = minC + maxSpan - 1;
  }

  return { minR, maxR, minC, maxC };
}
