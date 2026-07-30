"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ProfileChip, ProfileGate, useProfile } from "@/components/profile-gate";
import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { useLocale } from "@/components/i18n/locale-provider";
import { Logo } from "@/components/logo";
import { PinJoinForm } from "@/components/pin-join-form";
import { createRoom } from "@/lib/rooms/api";
import { BRAND } from "@/lib/constants";
import { getGameBySlug } from "@/lib/games/catalog";
import { getGameCopy } from "@/lib/i18n/dictionaries";

function PlayContent() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  useProfile();
  const { t, href, dict } = useLocale();
  const game = getGameBySlug(params.slug);
  const copy = game ? getGameCopy(dict, game.id) : undefined;
  const [error, setError] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!game) return;
    document.title = `${game.title} — ${BRAND.name}`;
  }, [game]);

  if (!game) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-danger">{t("play.notFound")}</p>
        <Link href={href("/")} className="btn btn-secondary">
          {t("common.games")}
        </Link>
      </div>
    );
  }

  if (game.status !== "live") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-2xl font-extrabold text-text">{game.title}</p>
        <p className="max-w-sm text-text-muted">{t("play.soonBody")}</p>
        <Link href={href("/")} className="btn btn-primary">
          {t("play.backToGames")}
        </Link>
      </div>
    );
  }

  function onCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const room = await createRoom(game!.id);
        router.push(href(`/room/${room.id}`));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : t("play.createFailed"),
        );
      }
    });
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(61,157,196,0.18),_transparent_55%)]"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-5 py-4 sm:max-w-xl">
        <Logo size="lg" />
        <div className="flex items-center gap-3">
          <LocaleToggle />
          <ProfileChip />
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 px-5 pb-8 sm:max-w-xl">
        <Link
          href={href("/")}
          className="text-sm font-semibold text-text-muted hover:text-accent"
        >
          {t("play.back")}
        </Link>

        <div className="text-center">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-text sm:text-5xl">
            {game.title}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-base text-text-muted">
            {copy?.blurb ?? ""}
          </p>
          <p className="mt-2 text-sm text-text-dim">{copy?.meta ?? ""}</p>
        </div>

        <button
          type="button"
          className="btn btn-primary w-full min-h-14 text-lg shadow-[0_22px_36px_-6px_rgba(61,157,196,0.55)]"
          disabled={pending}
          onClick={onCreate}
        >
          {pending ? t("play.starting") : t("play.startRoom")}
        </button>

        <div className="rounded-2xl border border-border/70 bg-bg-card/40">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-text"
            aria-expanded={howOpen}
            onClick={() => setHowOpen((v) => !v)}
          >
            {t("play.howTo")}
            <span className="text-text-dim" aria-hidden>
              {howOpen ? "−" : "+"}
            </span>
          </button>
          {howOpen && copy && (
            <ol className="space-y-2 border-t border-border/60 px-4 py-3 text-sm text-text-muted">
              {copy.howTo.map((step: string, i: number) => (
                <li key={step} className="flex gap-2">
                  <span className="font-bold text-accent">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card flex w-full flex-col gap-3 border-accent/25 p-5">
          <h2 className="text-center text-lg font-bold text-text">
            {t("play.joinTitle")}
          </h2>
          <p className="text-center text-sm text-text-muted">
            {t("play.joinHint")}
          </p>
          <PinJoinForm showHeading={false} />
        </div>

        {error && (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}

export default function PlayPage() {
  return (
    <ProfileGate>
      <PlayContent />
    </ProfileGate>
  );
}
