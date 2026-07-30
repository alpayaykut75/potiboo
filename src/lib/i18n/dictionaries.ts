import type { Locale } from "./config";
import { defaultLocale, isLocale } from "./config";
import tr from "../../../locales/tr.json";
import en from "../../../locales/en.json";

const dictionaries = { tr, en } as const;

export type Dictionary = typeof tr;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

export function resolveLocale(value: string | null | undefined): Locale {
  if (value && isLocale(value)) return value;
  return defaultLocale;
}

type Vars = Record<string, string | number>;

/** `Hello {name}` + { name: "Ada" } → `Hello Ada` */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`,
  );
}

type GameCopy = Dictionary["gameCopy"][keyof Dictionary["gameCopy"]];

export function getGameCopy(
  dict: Dictionary,
  gameId: string,
): GameCopy | undefined {
  return dict.gameCopy[gameId as keyof Dictionary["gameCopy"]];
}
