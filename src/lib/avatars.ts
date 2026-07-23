export interface AvatarDef {
  id: string;
  label: string;
  src: string;
  emoji: string;
}

/** Quiboo’dan taşınan 10 takım elbiseli hayvan avatarı */
export const AVATARS: AvatarDef[] = [
  { id: "panda", label: "Panda", src: "/avatars/panda.jpg", emoji: "🐼" },
  { id: "lion", label: "Aslan", src: "/avatars/lion.jpg", emoji: "🦁" },
  { id: "tiger", label: "Kaplan", src: "/avatars/tiger.jpg", emoji: "🐯" },
  { id: "bear", label: "Ayı", src: "/avatars/bear.jpg", emoji: "🐻" },
  { id: "cat", label: "Kedi", src: "/avatars/cat.jpg", emoji: "🐱" },
  { id: "dog", label: "Köpek", src: "/avatars/dog.jpg", emoji: "🐶" },
  { id: "koala", label: "Koala", src: "/avatars/koala.jpg", emoji: "🐨" },
  { id: "sloth", label: "Tembel", src: "/avatars/sloth.jpg", emoji: "🦥" },
  { id: "bull", label: "Boğa", src: "/avatars/bull.jpg", emoji: "🐮" },
  { id: "bird", label: "Papağan", src: "/avatars/bird.jpg", emoji: "🦜" },
];

export type AvatarId = (typeof AVATARS)[number]["id"];

const byId = new Map(AVATARS.map((a) => [a.id, a]));

export function getAvatar(id: string): AvatarDef | undefined {
  return byId.get(id);
}

export function isAvatarId(id: string): boolean {
  return byId.has(id);
}
