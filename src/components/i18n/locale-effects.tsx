"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { switchLocalePath } from "@/lib/i18n/paths";

/** html lang + localStorage + diğer sekmelerle dil senkronu */
export function LocaleEffects({ locale }: { locale: Locale }) {
  const pathname = usePathname() || "/";

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_COOKIE, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LOCALE_COOKIE || !e.newValue) return;
      if (!isLocale(e.newValue) || e.newValue === locale) return;
      window.location.replace(switchLocalePath(pathname, e.newValue));
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [locale, pathname]);

  return null;
}
