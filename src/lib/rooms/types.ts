import { GAME } from "@/lib/constants";
import type { GameId } from "@/lib/games/catalog";
import type { RoomSettings } from "@/lib/games/xox";
import { defaultSettingsFor } from "@/lib/games/xox";

export type RoomStatus = "lobby" | "playing" | "finished";

export type { RoomSettings };

export type Room = {
  id: string;
  pin: string;
  host_id: string;
  status: RoomStatus;
  settings: RoomSettings;
  current_round: number;
  created_at: string;
  used_letters: string[];
  game_type: GameId;
};

export type RoomPlayer = {
  id: string;
  room_id: string;
  profile_id: string;
  join_order: number;
  is_connected: boolean;
  total_score: number;
  joined_at: string;
};

export type RoomPlayerWithProfile = RoomPlayer & {
  profiles: {
    display_name: string;
    avatar_key: string;
  } | null;
};

export function defaultSettings(
  gameType: GameId = "isim_sehir",
): RoomSettings {
  if (gameType === "isim_sehir") {
    return {
      duration: GAME.defaultDurationSec,
      roundCount: GAME.defaultRounds,
      categories: [...GAME.defaultCategories],
      speedBonus: GAME.speedBonusEnabledDefault,
    };
  }
  return defaultSettingsFor(gameType);
}
