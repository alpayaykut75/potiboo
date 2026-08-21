/** Potiboo oyun kataloğu — isimler i18n dışı; blurb/meta/howTo locales’te */

export const GAME_IDS = [
  "isim_sehir",
  "xox",
  "synked",
  "onluk",
  "interval",
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
  /** Eski URL’ler (301 yönlendirme) */
  legacySlugs?: readonly string[];
  /** Görünen ad — her dilde aynı */
  title: string;
  status: GameStatus;
  accent: string;
};

/**
 * İsim kuralı (yeni oyun): 2 hece, ≤7 harf, -o/-a ile biter;
 * uluslararası kök; C/J/Q/W ve Türkçe özel harf yok; üç dilde aynı.
 */
export const GAMES: GameMeta[] = [
  {
    id: "isim_sehir",
    slug: "listo",
    legacySlugs: ["stoppa", "isim-sehir"],
    title: "Listo",
    status: "live",
    accent: "#3d9dc4",
  },
  {
    id: "xox",
    slug: "toxxo",
    legacySlugs: ["xox"],
    title: "Toxxo",
    status: "live",
    accent: "#5bb8a8",
  },
  {
    id: "synked",
    slug: "simmo",
    legacySlugs: ["synked"],
    title: "Simmo",
    status: "live",
    accent: "#c47bb8",
  },
  {
    id: "onluk",
    slug: "dekko",
    legacySlugs: ["onluk"],
    title: "Dekko",
    status: "live",
    accent: "#e8a45c",
  },
  {
    id: "interval",
    slug: "middo",
    legacySlugs: ["interval"],
    title: "Middo",
    status: "live",
    accent: "#3d9dc4",
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
    slug: "mutto",
    legacySlugs: ["muto", "tabu"],
    title: "Mutto",
    status: "soon",
    accent: "#e8b84a",
  },
  {
    id: "kizma_birader",
    slug: "bumpo",
    legacySlugs: ["kizma-birader"],
    title: "Bumpo",
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

/** Eski slug → kanonik slug (301) */
export function legacySlugRedirects(): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const game of GAMES) {
    for (const legacy of game.legacySlugs ?? []) {
      if (legacy !== game.slug) {
        out.push({ from: legacy, to: game.slug });
      }
    }
  }
  return out;
}
