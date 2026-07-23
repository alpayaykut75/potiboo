export type PlayerProfile = {
  displayName: string;
  avatarKey: string;
  /** Supabase auth user id; yerel modda da üretilir */
  userId: string;
};

export const PROFILE_STORAGE_KEY = "potiboo_profile";

export function readLocalProfile(): PlayerProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    if (
      typeof parsed.displayName !== "string" ||
      typeof parsed.avatarKey !== "string" ||
      typeof parsed.userId !== "string"
    ) {
      return null;
    }
    return {
      displayName: parsed.displayName,
      avatarKey: parsed.avatarKey,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

export function writeLocalProfile(profile: PlayerProfile): void {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}
