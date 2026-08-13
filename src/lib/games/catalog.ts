/** Potiboo oyun kataloğu — isimler i18n dışı; blurb/meta/howTo locales’te */

export const GAME_IDS = [
  "isim_sehir",
  "xox",
  "synked",
  "onluk",
  "wordle",
  "amiral",
  "tabu",
  "kizma_birader",
] as const;

export type GameId = (typeof GAME_IDS)[number];

export type GameStatus = "live" | "soon";

export type GameMeta = {
  id: GameId;
  /** URL: /play/[slug] */
  slug: string;
  /** Eski URL’ler (yönlendirme) */
  legacySlugs?: readonly string[];
  /** Görünen ad — her dilde aynı */
  title: string;
  status: GameStatus;
  accent: string;
};

export const GAMES: GameMeta[] = [
  {
    id: "isim_sehir",
    slug: "stoppa",
    legacySlugs: ["isim-sehir"],
    title: "Stoppa",
    status: "live",
    accent: "#3d9dc4",
  },
  {
    id: "xox",
    slug: "xox",
    title: "XOX",
    status: "live",
    accent: "#5bb8a8",
  },
  {
    id: "synked",
    slug: "synked",
    title: "Synked",
    status: "live",
    accent: "#c47bb8",
  },
  {
    id: "onluk",
    slug: "onluk",
    title: "Onluk",
    status: "live",
    accent: "#e8a45c",
  },
  {
    id: "wordle",
    slug: "lettro",
    legacySlugs: ["wordle", "harf-bul"],
    title: "Lettro",
    status: "soon",
    accent: "#3ecf8e",
  },
  {
    id: "amiral",
    slug: "flotto",
    legacySlugs: ["amiral"],
    title: "Flotto",
    status: "soon",
    accent: "#4aafd6",
  },
  {
    id: "tabu",
    slug: "muto",
    legacySlugs: ["tabu"],
    title: "Muto",
    status: "soon",
    accent: "#e8b84a",
  },
  {
    id: "kizma_birader",
    slug: "kizma-birader",
    title: "Kızma Birader",
    status: "soon",
    accent: "#e85d5d",
  },
];

/** Aktif oyunlar önce */
export function gamesForHome(): GameMeta[] {
  return [...GAMES].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === "live" ? -1 : 1;
  });
}

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function getGameById(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id);
}

export function getGameBySlug(slug: string): GameMeta | undefined {
  return GAMES.find(
    (g) => g.slug === slug || g.legacySlugs?.includes(slug),
  );
}

export function gameTitle(id: string | null | undefined): string {
  return getGameById(id ?? "")?.title ?? "Potiboo";
}
