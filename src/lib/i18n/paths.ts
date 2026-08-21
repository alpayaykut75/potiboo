import {
  defaultLocale,
  isLocale,
  type Locale,
} from "./config";

/** `/play/listo` + `en` → `/en/play/listo` */
export function withLocale(path: string, locale: Locale): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return `/${locale}`;
  return `/${locale}${clean}`;
}

/** `/en/play/listo` → `{ locale: "en", pathname: "/play/listo" }` */
export function stripLocale(pathname: string): {
  locale: Locale | null;
  pathname: string;
} {
  const parts = pathname.split("/");
  // ["", "en", "play", ...]
  const maybe = parts[1];
  if (maybe && isLocale(maybe)) {
    const rest = "/" + parts.slice(2).join("/");
    return {
      locale: maybe,
      pathname: rest === "/" ? "/" : rest.replace(/\/$/, "") || "/",
    };
  }
  return { locale: null, pathname };
}

export function switchLocalePath(
  fullPathname: string,
  nextLocale: Locale,
): string {
  const { pathname } = stripLocale(fullPathname);
  const search = typeof window !== "undefined" ? window.location.search : "";
  return withLocale(pathname || "/", nextLocale) + search;
}

export function localeFromPathname(pathname: string): Locale {
  return stripLocale(pathname).locale ?? defaultLocale;
}
