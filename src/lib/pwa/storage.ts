const KEY = "potiboo_pwa_v1";
const listeners = new Set<() => void>();

type PwaState = {
  standaloneSeen: boolean;
  shownIds: string[];
  dismissCount: number;
  lastDismissedId: string | null;
  completedIds: string[];
};

const empty = (): PwaState => ({
  standaloneSeen: false,
  shownIds: [],
  dismissCount: 0,
  lastDismissedId: null,
  completedIds: [],
});

function read(): PwaState {
  if (typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<PwaState>;
    return {
      standaloneSeen: Boolean(parsed.standaloneSeen),
      shownIds: Array.isArray(parsed.shownIds)
        ? parsed.shownIds.map(String)
        : [],
      dismissCount:
        typeof parsed.dismissCount === "number" ? parsed.dismissCount : 0,
      lastDismissedId:
        typeof parsed.lastDismissedId === "string"
          ? parsed.lastDismissedId
          : null,
      completedIds: Array.isArray(parsed.completedIds)
        ? parsed.completedIds.map(String)
        : [],
    };
  } catch {
    return empty();
  }
}

function write(next: PwaState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  listeners.forEach((fn) => fn());
}

export function subscribePwaState(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function markStandaloneSeen(): void {
  const state = read();
  if (state.standaloneSeen) return;
  write({ ...state, standaloneSeen: true });
}

export function hasStandaloneSeen(): boolean {
  return read().standaloneSeen;
}

export function markGameCompleted(completionId: string): void {
  const state = read();
  if (state.completedIds.includes(completionId)) return;
  const completedIds = [...state.completedIds, completionId];
  if (completedIds.length > 40) completedIds.splice(0, completedIds.length - 40);
  write({ ...state, completedIds });
}

export function completedGameCount(): number {
  return read().completedIds.length;
}

export function shouldShowInstallHint(completionId: string): boolean {
  const state = read();
  if (state.standaloneSeen) return false;
  if (state.dismissCount >= 2) return false;
  if (state.completedIds.length < 1) return false;
  if (state.lastDismissedId === completionId) return false;
  if (state.shownIds.includes(completionId)) return true;
  return state.shownIds.length < 2;
}

export function markHintShown(completionId: string): void {
  const state = read();
  if (state.shownIds.includes(completionId)) return;
  write({ ...state, shownIds: [...state.shownIds, completionId] });
}

export function dismissInstallHint(completionId: string): void {
  const state = read();
  write({
    ...state,
    dismissCount: Math.min(2, state.dismissCount + 1),
    lastDismissedId: completionId,
  });
}

export function shouldShowInstallMenuItem(): boolean {
  return !read().standaloneSeen;
}

/** Debug: state'i sıfırla — sadece geliştirme amaçlı */
export function _resetPwaState(): void {
  try {
    localStorage.removeItem(KEY);
    listeners.forEach((fn) => fn());
  } catch {
    // ignore
  }
}
