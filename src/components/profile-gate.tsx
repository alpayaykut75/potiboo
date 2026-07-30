"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { bootstrapProfile, saveProfile } from "@/lib/profile/bootstrap";
import type { PlayerProfile } from "@/lib/profile/storage";
import { ProfileSetup } from "@/components/profile-setup";
import { AvatarImage } from "@/components/avatar-image";
import { useLocale } from "@/components/i18n/locale-provider";

type ProfileContextValue = {
  profile: PlayerProfile;
  updateProfile: (input: {
    displayName: string;
    avatarKey: string;
  }) => Promise<void>;
  applyProfile: (profile: PlayerProfile) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile yalnızca profil yüklendikten sonra kullanılır.");
  }
  return ctx;
}

export function ProfileGate({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"supabase" | "local">("local");
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await bootstrapProfile();
        if (cancelled) return;
        setProfile(result.profile);
        setMode(result.mode);
        setBootError(null);
      } catch (e) {
        if (cancelled) return;
        console.warn(e);
        setBootError(
          e instanceof Error ? e.message : "Bağlantı kurulamadı",
        );
        setProfile(null);
        setMode("local");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateProfile = useCallback(
    async (input: { displayName: string; avatarKey: string }) => {
      const next = await saveProfile(input);
      setProfile(next);
      setMode("supabase");
    },
    [],
  );

  const applyProfile = useCallback((p: PlayerProfile) => {
    setProfile(p);
  }, []);

  const value = useMemo(
    () =>
      profile
        ? {
            profile,
            updateProfile,
            applyProfile,
          }
        : null,
    [profile, updateProfile, applyProfile],
  );

  if (!ready) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" />
        <p className="text-sm text-text-muted">{t("common.preparing")}</p>
      </div>
    );
  }

  if (!profile || !value) {
    return (
      <div className="flex flex-1 flex-col justify-center">
        {bootError && (
          <p className="mx-auto mb-2 max-w-sm px-5 text-center text-xs text-warning">
            {bootError} — yine de profil oluşturabilirsin.
          </p>
        )}
        <ProfileSetup onComplete={setProfile} />
      </div>
    );
  }

  return (
    <ProfileContext.Provider value={value}>
      {mode === "local" && (
        <div className="shrink-0 bg-warning/15 px-3 py-2 text-center text-xs text-warning">
          Supabase bağlantısı zayıf — profil bu cihazda; odaya katılım için
          yeniden dene.
        </div>
      )}
      {children}
    </ProfileContext.Provider>
  );
}

/** Ana ekran: tıklanınca profil düzenle */
export function ProfileChip() {
  const { profile, applyProfile } = useProfile();
  const [editing, setEditing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card/80 py-1.5 pr-2 pl-1.5 transition hover:border-accent/50 sm:pr-3"
        aria-label="Profili düzenle"
      >
        <AvatarImage avatar={profile.avatarKey} size="sm" />
        <span className="hidden max-w-[8rem] truncate text-sm font-semibold text-text sm:inline">
          {profile.displayName}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-text-dim"
          aria-hidden
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>

      {mounted &&
        editing &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="Profili düzenle"
          >
            <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-bg shadow-2xl sm:max-w-md sm:rounded-3xl">
              <ProfileSetup
                title="Profilini düzenle"
                submitLabel="Kaydet"
                showBrand={false}
                initial={{
                  displayName: profile.displayName,
                  avatarKey: profile.avatarKey,
                }}
                onCancel={() => setEditing(false)}
                onComplete={(p) => {
                  applyProfile(p);
                  setEditing(false);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
