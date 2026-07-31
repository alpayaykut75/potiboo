"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, locales, type Locale } from "@/lib/i18n/config";
import { switchLocalePath } from "@/lib/i18n/paths";
import { useLocale } from "@/components/i18n/locale-provider";
import { clsx } from "@/lib/utils";

const LOCALE_META: Record<Locale, { code: string; name: string }> = {
  tr: { code: "TR", name: "Türkçe" },
  en: { code: "EN", name: "English" },
  id: { code: "ID", name: "Bahasa Indonesia" },
};

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
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = LOCALE_META[locale];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function place() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const menu = document.getElementById(menuId);
      if (menu?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menuId]);

  const menu =
    open &&
    mounted &&
    menuPos &&
    createPortal(
      <ul
        id={menuId}
        role="listbox"
        aria-label={t("common.langSwitch")}
        style={{ top: menuPos.top, right: menuPos.right }}
        className="fixed z-[300] min-w-[11.5rem] overflow-hidden rounded-2xl border border-border bg-bg-card py-1 shadow-xl shadow-black/50"
      >
        {locales.map((code) => {
          const meta = LOCALE_META[code];
          const active = locale === code;
          return (
            <li key={code} role="option" aria-selected={active}>
              <Link
                href={switchLocalePath(pathname, code)}
                hrefLang={code}
                onClick={() => {
                  persistLocale(code);
                  setOpen(false);
                }}
                className={clsx(
                  "flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold transition",
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-text hover:bg-white/5",
                )}
              >
                <span className="flex-1">{meta.name}</span>
                <span className="text-xs font-bold text-text-dim">
                  {meta.code}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>,
      document.body,
    );

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-bg-card/80 px-3 text-sm font-bold text-text transition hover:border-accent/50"
        aria-label={t("common.langSwitch")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.code}</span>
        <span
          className={clsx(
            "text-xs text-text-dim transition",
            open && "rotate-180",
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}
