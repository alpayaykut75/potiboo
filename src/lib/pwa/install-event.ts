export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function captureInstallPrompt(event: BeforeInstallPromptEvent): void {
  event.preventDefault();
  deferred = event;
  listeners.forEach((fn) => fn());
}

export function clearInstallPrompt(): void {
  deferred = null;
  listeners.forEach((fn) => fn());
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  clearInstallPrompt();
  return outcome;
}
