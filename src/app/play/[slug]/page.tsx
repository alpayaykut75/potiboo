"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ProfileChip, ProfileGate, useProfile } from "@/components/profile-gate";
import { Logo } from "@/components/logo";
import { createRoom, joinRoomByPin } from "@/lib/rooms/api";
import { normalizePin } from "@/lib/rooms/pin";
import { getGameBySlug } from "@/lib/games/catalog";

function PlayContent() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  useProfile();
  const game = getGameBySlug(params.slug);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!game) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-danger">Oyun bulunamadı.</p>
        <Link href="/" className="btn btn-secondary">
          Ana sayfa
        </Link>
      </div>
    );
  }

  if (game.status !== "live") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-2xl font-extrabold text-text">{game.title}</p>
        <p className="max-w-sm text-text-muted">
          Bu oyun yakında. Şimdilik İsim Şehir ile devam edebilirsin.
        </p>
        <Link href="/" className="btn btn-primary">
          Oyunlara dön
        </Link>
      </div>
    );
  }

  function onCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const room = await createRoom(game!.id);
        router.push(`/room/${room.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Oda oluşturulamadı");
      }
    });
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const room = await joinRoomByPin(pin);
        router.push(`/room/${room.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Katılınamadı");
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
        <ProfileChip />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 px-5 pb-8 sm:max-w-xl">
        <Link
          href="/"
          className="text-sm font-semibold text-text-muted hover:text-accent"
        >
          ← Oyunlar
        </Link>

        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            {game.title}
          </span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-text sm:text-4xl">
            Arkadaşlarınla{" "}
            <span className="text-accent">aynı anda</span> oyna.
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
            {game.blurb} · {game.players} oyuncu
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary w-full min-h-14 text-lg shadow-[0_22px_36px_-6px_rgba(61,157,196,0.55)]"
          disabled={pending}
          onClick={onCreate}
        >
          {pending ? "Oluşturuluyor…" : "Yeni Oyun"}
        </button>

        <form
          onSubmit={onJoin}
          className="card flex w-full flex-col gap-3 border-accent/25 p-5"
        >
          <h2 className="text-center text-lg font-bold text-text">
            Oyuna katıl
          </h2>
          <p className="text-center text-sm text-text-muted">
            Ekrandaki PIN&apos;i gir
          </p>
          <input
            value={pin}
            onChange={(e) => setPin(normalizePin(e.target.value).slice(0, 4))}
            placeholder="PIN"
            autoComplete="off"
            inputMode="text"
            className="w-full rounded-2xl border-2 border-border-strong bg-bg-elevated px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.35em] text-text outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="btn w-full border-2 border-accent bg-transparent text-accent hover:bg-accent/15"
            disabled={pending || pin.length < 4}
          >
            {pending ? "Katılıyor…" : "Katıl"}
          </button>
        </form>

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
