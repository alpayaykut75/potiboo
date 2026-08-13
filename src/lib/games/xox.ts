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

/** XOX ayarları */
export type XoxSettings = {
  boardSize: XoxBoardSize;
  winLength: number;
};

export type RoomSettings = IsımSehirSettings & Partial<XoxSettings>;

export function defaultWinLength(boardSize: XoxBoardSize): number {
  if (boardSize === 0) return 5;
  if (boardSize === 5) return 4;
  return 3;
}

export function emptyXoxBoard(boardSize: XoxBoardSize): string[] {
  if (boardSize === 0) return [];
  return Array(boardSize * boardSize).fill("");
}

export function resolveXoxBoard(
  settings: Partial<XoxSettings> | null | undefined,
): { boardSize: XoxBoardSize; winLength: number } {
  const raw = settings?.boardSize;
  const boardSize: XoxBoardSize =
    raw === 0 || raw === 5 || raw === 3 ? raw : 3;
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
    };
  }
  if (gameType === "synked" || gameType === "onluk") {
    return {
      duration: 60,
      roundCount: 1,
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
  updated_at: string;
};

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
