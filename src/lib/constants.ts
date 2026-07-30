/** Marka — motto çevrilmez, i18n dışı */
export const BRAND = {
  name: "Potiboo",
  motto: "Fun, together",
} as const;

/** Game defaults from product spec */
export const GAME = {
  minPlayers: 2,
  maxPlayers: 8,
  defaultRounds: 5,
  defaultDurationSec: 60,
  defaultCategories: ["İsim", "Şehir", "Hayvan", "Bitki", "Eşya"] as const,
  /** Lobide en fazla 2 tanesi eklenebilir */
  extraCategories: ["Ünlü", "Ülke", "Meslek", "Marka", "Film"] as const,
  speedBonusEnabledDefault: true,
  objectionsPerRound: 2,
  objectionVoteSec: 15,
  /** Kategori ekranında kurucu Devam kilidi */
  categoryRevealSec: 5,
  /** Varsayılan 5 + en fazla 2 ilave */
  maxExtraCategories: 2,
  uniqueAnswerPoints: 20,
  sharedAnswerPoints: 10,
  speedBonusByRank: [10, 6, 3, 1] as const,
} as const;

/**
 * Letter pool: Ğ excluded. Ç/Ş/Ü/Ö/İ are not separate pool letters;
 * C/S/U/O/I accept both plain and dotted/cedilla variants.
 */
export const LETTER_POOL = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "R",
  "S",
  "T",
  "U",
  "V",
  "Y",
  "Z",
] as const;

/** Oda PIN uzunluğu (sayısal). ~100 eşzamanlı odaya kadar 4 yeterli; config’ten yükseltilir */
export const PIN_LENGTH = 4;
