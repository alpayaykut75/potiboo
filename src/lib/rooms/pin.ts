import { PIN_LENGTH } from "@/lib/constants";

/** Sayısal oda PIN’i — uzunluk `PIN_LENGTH` */
export function generatePin(length = PIN_LENGTH): string {
  let pin = "";
  for (let i = 0; i < length; i++) {
    pin += String(Math.floor(Math.random() * 10));
  }
  return pin;
}

/** Sadece rakam; boşluk/tire temizlenir */
export function normalizePin(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

/** Görüntü: `4 8 2 1` */
export function formatPinDisplay(pin: string): string {
  const digits = normalizePin(pin);
  return digits.split("").join(" ");
}

export function isCompletePin(pin: string): boolean {
  return normalizePin(pin).length === PIN_LENGTH;
}
