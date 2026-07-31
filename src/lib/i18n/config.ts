export const locales = ["tr", "en", "id"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "tr";

export const LOCALE_COOKIE = "potiboo_locale";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
