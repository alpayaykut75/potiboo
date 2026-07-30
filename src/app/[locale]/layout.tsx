import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocaleEffects } from "@/components/i18n/locale-effects";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { BRAND } from "@/lib/constants";
import { isLocale, locales, type Locale } from "@/lib/i18n/config";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : "tr") as Locale;
  return {
    title: `${BRAND.name} — ${BRAND.motto}`,
    description:
      locale === "en"
        ? "Fun, together. Party games with family and friends — join with a PIN or QR"
        : "Fun, together. Aile ve arkadaşlarınla parti oyunları — PIN veya karekod ile katıl",
    alternates: {
      languages: {
        tr: "/tr",
        en: "/en",
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;

  return (
    <LocaleProvider locale={locale}>
      <LocaleEffects locale={locale} />
      {children}
    </LocaleProvider>
  );
}
