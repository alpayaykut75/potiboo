import { LETTER_POOL } from "@/lib/constants";

export function availableLetters(used: string[] | null | undefined): string[] {
  const usedSet = new Set(
    (used ?? []).map((l) => l.toLocaleUpperCase("tr-TR")),
  );
  return LETTER_POOL.filter((l) => !usedSet.has(l));
}

/**
 * @param used Bu odadaki kullanılmış harfler (zorunlu hariç)
 * @param softAvoid Son oyunlardan gelen “yumuşak” kaçınma (havuz daralırsa yok sayılır)
 */
export function pickSpinLetter(
  used: string[] | null | undefined,
  softAvoid: string[] | null | undefined = [],
): string {
  const hard = availableLetters(used);
  if (hard.length === 0) {
    return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
  }

  const avoid = new Set(
    (softAvoid ?? []).map((l) => l.toLocaleUpperCase("tr-TR")),
  );
  const soft = hard.filter((l) => !avoid.has(l));
  // En az 3 seçenek kalsın; yoksa soft kaçınmayı bırak (oyun kitlenmesin)
  const pool = soft.length >= 3 ? soft : hard;
  return pool[Math.floor(Math.random() * pool.length)];
}
