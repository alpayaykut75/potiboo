/** Potiboo oyun kataloğu — platform iskeleti */

export const GAME_IDS = [
  "isim_sehir",
  "xox",
  "synked",
  "wordle",
  "amiral",
  "tabu",
  "kizma_birader",
] as const;

export type GameId = (typeof GAME_IDS)[number];

export type GameStatus = "live" | "soon";

export type GameMeta = {
  id: GameId;
  /** URL segment: /play/isim-sehir */
  slug: string;
  title: string;
  blurb: string;
  players: string;
  status: GameStatus;
  /** Kart vurgusu */
  accent: string;
};

export const GAMES: GameMeta[] = [
  {
    id: "isim_sehir",
    slug: "isim-sehir",
    title: "İsim Şehir",
    blurb: "Aynı anda yaz, DUR de, itiraz et.",
    players: "2–8",
    status: "live",
    accent: "#3d9dc4",
  },
  {
    id: "xox",
    slug: "xox",
    title: "XOX",
    blurb: "Klasik üç taş; hızlı turlar.",
    players: "2",
    status: "live",
    accent: "#5bb8a8",
  },
  {
    id: "synked",
    slug: "synked",
    title: "Synked",
    blurb: "İki kelimeden birine ulaşana kadar.",
    players: "2 / 4",
    status: "live",
    accent: "#c47bb8",
  },
  {
    id: "wordle",
    slug: "wordle",
    title: "Harf Bul",
    blurb: "Yeşil / sarı ipuçlarıyla kelimeyi yakala.",
    players: "1–4",
    status: "soon",
    accent: "#3ecf8e",
  },
  {
    id: "amiral",
    slug: "amiral",
    title: "Amiral Battı",
    blurb: "Gemilerini gizle, rakibi batır.",
    players: "2",
    status: "soon",
    accent: "#4aafd6",
  },
  {
    id: "tabu",
    slug: "tabu",
    title: "Tabu",
    blurb: "Yasaklı kelimelere takılmadan anlat.",
    players: "4–8",
    status: "soon",
    accent: "#e8b84a",
  },
  {
    id: "kizma_birader",
    slug: "kizma-birader",
    title: "Kızma Birader",
    blurb: "Zar at, kes, eve gir.",
    players: "2–4",
    status: "soon",
    accent: "#e85d5d",
  },
];

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function getGameById(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id);
}

export function getGameBySlug(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}

export function gameTitle(id: string | null | undefined): string {
  return getGameById(id ?? "")?.title ?? "Potiboo";
}
