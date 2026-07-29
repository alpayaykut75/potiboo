/**
 * Cihazda son oyunların harfleri — ardışık oyunlarda tekrar azaltır.
 * Sunucu odası used_letters ile birleştirilir.
 */
const RECENT_KEY = "potiboo_recent_letters";
const RECENT_MAX = 12;

export function readRecentLetters(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((l) => l.toLocaleUpperCase("tr-TR"));
  } catch {
    return [];
  }
}

export function pushRecentLetter(letter: string): void {
  if (typeof window === "undefined") return;
  const L = letter.toLocaleUpperCase("tr-TR");
  const prev = readRecentLetters().filter((x) => x !== L);
  const next = [L, ...prev].slice(0, RECENT_MAX);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
