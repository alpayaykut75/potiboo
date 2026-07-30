"use client";

import { useEffect } from "react";
import type { Locale } from "@/lib/i18n/config";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

/** html lang + localStorage senkronu */
export function LocaleEffects({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_COOKIE, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  return null;
}
