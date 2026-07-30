"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Locale } from "@/lib/i18n/config";
import {
  getDictionary,
  interpolate,
  type Dictionary,
} from "@/lib/i18n/dictionaries";
import { withLocale } from "@/lib/i18n/paths";

type Vars = Record<string, string | number>;

type LocaleContextValue = {
  locale: Locale;
  dict: Dictionary;
  t: (path: string, vars?: Vars) => string;
  href: (path: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readPath(dict: Dictionary, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const dict = useMemo(() => getDictionary(locale), [locale]);

  const t = useCallback(
    (path: string, vars?: Vars) => {
      const raw = readPath(dict, path);
      if (!raw) return path;
      return interpolate(raw, vars);
    },
    [dict],
  );

  const href = useCallback(
    (path: string) => withLocale(path, locale),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, dict, t, href }),
    [locale, dict, t, href],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
