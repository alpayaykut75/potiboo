import { GAME } from "@/lib/constants";

export type RoomStatus = "lobby" | "playing" | "finished";

export type RoomSettings = {
  duration: number;
  roundCount: number;
  categories: string[];
  speedBonus: boolean;
};

export type Room = {
  id: string;
  pin: string;
  host_id: string;
  status: RoomStatus;
  settings: RoomSettings;
  current_round: number;
  created_at: string;
  /** Bu odada çıkan harfler — tekrar etmez */
  used_letters: string[];
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

export function defaultSettings(): RoomSettings {
  return {
    duration: GAME.defaultDurationSec,
    roundCount: GAME.defaultRounds,
    categories: [...GAME.defaultCategories],
    speedBonus: GAME.speedBonusEnabledDefault,
  };
}
