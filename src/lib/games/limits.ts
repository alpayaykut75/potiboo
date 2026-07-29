/** Oyun bazlı oyuncu limitleri */
import type { GameId } from "@/lib/games/catalog";

export function gamePlayerLimits(gameType: GameId | string | null | undefined): {
  min: number;
  max: number;
} {
  switch (gameType) {
    case "xox":
      return { min: 2, max: 2 };
    case "synked":
      return { min: 2, max: 4 };
    case "amiral":
      return { min: 2, max: 2 };
    case "wordle":
      return { min: 1, max: 4 };
    case "tabu":
      return { min: 4, max: 8 };
    case "kizma_birader":
      return { min: 2, max: 4 };
    case "isim_sehir":
    default:
      return { min: 2, max: 8 };
  }
}
