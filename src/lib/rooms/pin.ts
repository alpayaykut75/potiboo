import { PIN_CHARS } from "@/lib/constants";

export function generatePin(length = 4): string {
  let pin = "";
  for (let i = 0; i < length; i++) {
    pin += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  }
  return pin;
}

export function normalizePin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
