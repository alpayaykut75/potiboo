import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocaleEffects } from "@/components/i18n/locale-effects";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap";
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
  const description =
    locale === "en"
      ? "Fun, together. Party games with family and friends — join with a PIN or QR"
      : locale === "id"
        ? "Fun, together. Game pesta bersama keluarga dan teman — gabung dengan PIN atau QR"
        : "Fun, together. Aile ve arkadaşlarınla parti oyunları — PIN veya karekod ile katıl";
  return {
    title: `${BRAND.name} — ${BRAND.motto}`,
    description,
    alternates: {
      languages: {
        tr: "/tr",
        en: "/en",
        id: "/id",
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
      <PwaBootstrap />
      {children}
    </LocaleProvider>
  );
}
