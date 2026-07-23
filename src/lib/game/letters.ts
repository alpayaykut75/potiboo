import { LETTER_POOL } from "@/lib/constants";

/** Havuz harfi → kabul edilen ilk harfler (Türkçe) */
const ACCEPT: Record<string, readonly string[]> = {
  C: ["C", "Ç"],
  S: ["S", "Ş"],
  U: ["U", "Ü"],
  O: ["O", "Ö"],
  I: ["I", "İ"],
};

export function acceptedStarts(letter: string): readonly string[] {
  const L = letter.toLocaleUpperCase("tr-TR");
  return ACCEPT[L] ?? [L];
}

/** Cevap doğru harfle başlıyor mu? (denklik kurallı) */
export function startsWithPoolLetter(value: string, letter: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const first = trimmed.charAt(0).toLocaleUpperCase("tr-TR");
  return acceptedStarts(letter).includes(first);
}

/** Aynılık: trim + tr küçük harf. Türkçe harf denkliği YOK. */
export function normalizeAnswer(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

export function randomPoolLetter(): string {
  return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
}

export { LETTER_POOL };
