import { LETTER_POOL } from "@/lib/constants";

export function availableLetters(used: string[] | null | undefined): string[] {
  const usedSet = new Set((used ?? []).map((l) => l.toLocaleUpperCase("tr-TR")));
  return LETTER_POOL.filter((l) => !usedSet.has(l));
}

export function pickSpinLetter(used: string[] | null | undefined): string {
  const pool = availableLetters(used);
  if (pool.length === 0) {
    // Havuz biterse (çok tur) tüm havuzu yeniden aç
    return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
