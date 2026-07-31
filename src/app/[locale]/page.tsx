"use client";

import Link from "next/link";
import { ProfileChip, ProfileGate, useProfile } from "@/components/profile-gate";
import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { useLocale } from "@/components/i18n/locale-provider";
import { Logo } from "@/components/logo";
import { gamesForHome } from "@/lib/games/catalog";
import { getGameCopy } from "@/lib/i18n/dictionaries";
import { clsx } from "@/lib/utils";

function HomeContent() {
  useProfile();
  const { t, href, dict } = useLocale();
  const games = gamesForHome();

  return (
    <div className="relative flex flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(61,157,196,0.18),_transparent_55%)]"
      />

      <header className="relative z-30 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-4 lg:px-8">
        <Link href={href("/")} className="min-w-0">
          <div className="sm:hidden">
            <Logo size="lg" showMotto />
          </div>
          <div className="hidden sm:block">
            <Logo size="xl" showMotto />
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <LocaleToggle />
          <ProfileChip />
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-8 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12 xl:gap-16">
          <div className="flex flex-col gap-6">
            <div className="text-center lg:text-left">
              <h1 className="text-3xl font-extrabold tracking-tight text-text sm:text-4xl lg:text-5xl">
                {t("home.titleBefore")}{" "}
                <span className="text-accent">{t("home.titleAccent")}</span>
              </h1>
              <p className="mt-2 text-sm text-text-muted sm:text-base">
                {t("home.subtitle")}
              </p>
            </div>

            <div className="relative h-[180px] max-h-[180px] overflow-hidden rounded-2xl border border-accent/20 shadow-[0_0_40px_-12px_rgba(61,157,196,0.45)] lg:hidden">
              <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-bg/50 via-transparent to-bg/20" />
              <video
                className="h-full w-full object-cover motion-reduce:hidden"
                src="/potiboo_video.mp4"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={t("home.videoLabel")}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {games.map((game) => {
                const live = game.status === "live";
                const copy = getGameCopy(dict, game.id);
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-bold text-text">
                        {game.title}
                      </h2>
                      <span
                        className={clsx(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          live
                            ? "bg-accent/20 text-accent"
                            : "bg-white/5 text-text-dim",
                        )}
                      >
                        {live ? t("common.play") : t("common.soon")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-text-muted">
                      {copy?.blurb ?? ""}
                    </p>
                    <p className="mt-3 text-xs text-text-dim">
                      {copy?.meta ?? ""}
                    </p>
                  </>
                );

                if (!live) {
                  return (
                    <div
                      key={game.id}
                      className="rounded-3xl border border-border/60 bg-bg-card/40 p-5 opacity-45"
                      aria-disabled
                    >
                      {inner}
                    </div>
                  );
                }

                return (
                  <Link
                    key={game.id}
                    href={href(`/play/${game.slug}`)}
                    className="rounded-3xl border border-accent/30 bg-bg-card p-5 transition hover:border-accent hover:bg-accent/5 sm:col-span-2 lg:col-span-1"
                    style={{ boxShadow: `0 0 40px -18px ${game.accent}` }}
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="relative hidden min-h-[28rem] overflow-hidden rounded-[2rem] border border-accent/25 shadow-[0_0_60px_-16px_rgba(61,157,196,0.55)] lg:block xl:min-h-[32rem]">
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-br from-bg/30 via-transparent to-accent/10" />
            <video
              className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
              src="/potiboo_video.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={t("home.videoLabel")}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <ProfileGate>
      <HomeContent />
    </ProfileGate>
  );
}
