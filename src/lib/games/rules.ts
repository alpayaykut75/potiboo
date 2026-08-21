import type { Locale } from "@/lib/i18n/config";
import type { GameId } from "@/lib/games/catalog";
import isimSehirTr from "../../../locales/rules/isim_sehir.tr.md";

/** Oyun id → locale → markdown (yalnızca dolu dosyalar) */
const RULES_MD: Partial<Record<GameId, Partial<Record<Locale, string>>>> = {
  isim_sehir: { tr: isimSehirTr },
};

export type RulesSection = {
  id: string;
  title: string;
  body: string;
};

export function getGameRulesMarkdown(
  gameId: string,
  locale: Locale,
): string | null {
  const byLocale = RULES_MD[gameId as GameId];
  if (!byLocale) return null;
  return byLocale[locale] ?? null;
}

export function hasGameRules(gameId: string, locale: Locale): boolean {
  return getGameRulesMarkdown(gameId, locale) != null;
}

/** `### Başlık` bloklarına ayır */
export function parseRulesSections(markdown: string): RulesSection[] {
  const parts = markdown.split(/^###\s+/m).map((p) => p.trim()).filter(Boolean);
  return parts.map((part, i) => {
    const nl = part.indexOf("\n");
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : part.slice(nl + 1)).trim();
    return {
      id: `sec-${i}-${title.toLowerCase().replace(/\s+/g, "-")}`,
      title,
      body,
    };
  });
}
