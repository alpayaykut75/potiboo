"use client";

import { useState } from "react";
import Link from "next/link";
import { AVATARS } from "@/lib/avatars";
import { saveProfile } from "@/lib/profile/bootstrap";
import type { PlayerProfile } from "@/lib/profile/storage";
import { AvatarImage } from "@/components/avatar-image";
import { Logo } from "@/components/logo";
import { clsx } from "@/lib/utils";

export function ProfileSetup({
  onComplete,
  onCancel,
  initial,
  title = "Avatarını ve ismini seç",
  submitLabel = "Devam",
  showBrand = true,
}: {
  onComplete: (profile: PlayerProfile) => void;
  onCancel?: () => void;
  initial?: { displayName: string; avatarKey: string };
  title?: string;
  submitLabel?: string;
  showBrand?: boolean;
}) {
  const [avatarKey, setAvatarKey] = useState(
    initial?.avatarKey ?? AVATARS[0].id,
  );
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const profile = await saveProfile({ displayName, avatarKey });
      onComplete(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-sm flex-col px-5 py-8"
    >
      <div className="text-center">
        {showBrand && (
          <div className="flex justify-center">
            <Link href="/">
              <Logo size="lg" showMotto />
            </Link>
          </div>
        )}
        <h1
          className={
            showBrand
              ? "mt-5 text-2xl font-extrabold text-text"
              : "text-2xl font-extrabold text-text"
          }
        >
          {title}
        </h1>
        {!initial && (
          <p className="mt-1 text-sm text-text-muted">
            Bir kez ayarlarsın; sonraki girişlerde hatırlanır.
          </p>
        )}
      </div>

      <div className="mt-8 flex justify-center">
        <AvatarImage
          avatar={avatarKey}
          size="3xl"
          className="ring-4 ring-accent/40"
        />
      </div>

      <div className="mt-6 grid grid-cols-5 gap-2">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAvatarKey(a.id)}
            aria-label={a.label}
            aria-pressed={avatarKey === a.id}
            className={clsx(
              "overflow-hidden rounded-2xl transition",
              avatarKey === a.id
                ? "ring-2 ring-accent ring-offset-2 ring-offset-bg"
                : "opacity-75 hover:opacity-100",
            )}
          >
            <AvatarImage
              avatar={a.id}
              size="lg"
              rounded="2xl"
              className="ring-0"
              alt={a.label}
            />
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor="display-name">
        İsmin
      </label>
      <input
        id="display-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value.slice(0, 16))}
        placeholder="İsmin"
        autoComplete="nickname"
        autoFocus
        maxLength={16}
        className="mt-6 w-full rounded-[var(--radius)] border-2 border-border-strong bg-bg-elevated px-4 py-4 text-center text-xl font-bold text-text outline-none transition placeholder:text-text-dim focus:border-accent"
      />

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-danger/15 px-3 py-2 text-center text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || displayName.trim().length < 2}
        className="btn btn-primary mt-4 w-full"
      >
        {loading ? "Kaydediliyor…" : submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          className="btn btn-ghost mt-2 w-full"
          onClick={onCancel}
        >
          Vazgeç
        </button>
      )}
    </form>
  );
}
