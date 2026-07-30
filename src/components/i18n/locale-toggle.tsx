"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, localeLabels, locales, type Locale } from "@/lib/i18n/config";
import { switchLocalePath } from "@/lib/i18n/paths";
import { useLocale } from "@/components/i18n/locale-provider";
import { clsx } from "@/lib/utils";

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_COOKIE, locale);
  } catch {
    // ignore
  }
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export function LocaleToggle({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const pathname = usePathname() || "/";

  return (
    <div
      role="group"
      aria-label={t("common.langSwitch")}
      className={clsx(
        "inline-flex items-center rounded-full border border-border bg-bg-card/80 p-0.5 text-xs font-bold",
        className,
      )}
    >
      {locales.map((code) => {
        const active = locale === code;
        const label = t(`common.${localeLabels[code]}`);
        return (
          <Link
            key={code}
            href={switchLocalePath(pathname, code)}
            hrefLang={code}
            onClick={() => persistLocale(code)}
            className={clsx(
              "rounded-full px-2 py-1.5 transition sm:px-2.5",
              active
                ? "bg-accent text-[#041018]"
                : "text-text-muted hover:text-text",
            )}
            aria-current={active ? "true" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
