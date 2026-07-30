/** Tohum kelime havuzu — anlamlı TR kelimeler (çağrışım için) */
export const SYNKED_SEED_POOL = [
  "deniz",
  "orman",
  "güneş",
  "ay",
  "yıldız",
  "yağmur",
  "kar",
  "ateş",
  "su",
  "toprak",
  "rüzgar",
  "bulut",
  "dağ",
  "nehir",
  "göl",
  "ada",
  "köprü",
  "yol",
  "ev",
  "kapı",
  "pencere",
  "masa",
  "kitap",
  "kalem",
  "müzik",
  "dans",
  "resim",
  "renk",
  "mavi",
  "kırmızı",
  "yeşil",
  "sarı",
  "siyah",
  "beyaz",
  "aşk",
  "dost",
  "aile",
  "çocuk",
  "anne",
  "baba",
  "okul",
  "öğretmen",
  "oyun",
  "top",
  "araba",
  "uçak",
  "tren",
  "bisiklet",
  "saat",
  "ayna",
  "rüya",
  "uyku",
  "kahve",
  "çay",
  "ekmek",
  "bal",
  "elma",
  "üzüm",
  "çiçek",
  "ağaç",
  "kuş",
  "balık",
  "kedi",
  "köpek",
  "aslan",
  "kelebek",
  "arı",
  "şehir",
  "köy",
  "sokak",
  "park",
  "bahçe",
  "gölge",
  "ışık",
  "ses",
  "sessizlik",
  "gülüş",
  "gözyaşı",
  "umut",
  "korku",
  "cesaret",
  "zaman",
  "anı",
  "gelecek",
  "geçmiş",
  "yolculuk",
  "harita",
  "pusula",
  "anahtar",
  "kilit",
  "sır",
  "hikaye",
  "masal",
  "şiir",
  "şarkı",
  "sahne",
  "perde",
  "kamera",
  "fotoğraf",
  "mektup",
  "zarf",
  "pul",
  "telefon",
  "ekran",
  "zar",
  "kart",
  "tahta",
  "kalp",
  "beyin",
  "el",
  "göz",
  "kulak",
  "gülümseme",
] as const;

export type SynkedRacePhase = "spin1" | "spin2" | "race" | "finished";

export type SynkedRaceRow = {
  room_id: string;
  phase: SynkedRacePhase;
  seed1: string | null;
  seed2: string | null;
  team0_a: string | null;
  team0_b: string | null;
  team1_a: string | null;
  team1_b: string | null;
  round: number;
  live_t0a: string;
  live_t0b: string;
  live_t1a: string;
  live_t1b: string;
  ready_t0a: boolean;
  ready_t0b: boolean;
  ready_t1a: boolean;
  ready_t1b: boolean;
  winner_team: 0 | 1 | null;
  updated_at: string;
  /** Bu turdaki kendi kilitli kelimen (sadece sen) */
  my_word: string | null;
};

export function parseSynkedRacePhase(raw: unknown): SynkedRacePhase {
  return raw === "spin2" || raw === "race" || raw === "finished" || raw === "spin1"
    ? raw
    : "spin1";
}
