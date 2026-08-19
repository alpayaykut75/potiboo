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
import { InstallCard } from "@/components/pwa/install-card";
import {
  isInAppBrowser,
  detectPwaPlatform,
  isStandaloneDisplay,
} from "@/lib/pwa/detect";
import {
  getDeferredInstallPrompt,
  subscribeInstallPrompt,
} from "@/lib/pwa/install-event";
import { subscribePwaState } from "@/lib/pwa/storage";
import { clsx } from "@/lib/utils";

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
        setBootError("boot_failed");
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
            {t("errors.bootFailed")}
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
          {t("errors.weakConnection")}
        </div>
      )}
      {children}
    </ProfileContext.Provider>
  );
}

/** Ana ekran: tıklanınca profil menüsü */
export function ProfileChip() {
  const { profile, applyProfile } = useProfile();
  const { t } = useLocale();
  const [view, setView] = useState<"closed" | "menu" | "edit" | "install">(
    "closed",
  );
  const [mounted, setMounted] = useState(false);
  // showInstall = can install (not yet standalone, not in-app browser, prompt available on desktop)
  // alreadyInstalled = currently running as standalone → menu item disabled
  const [showInstall, setShowInstall] = useState(false);
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshInstall = useCallback(() => {
    const platform = detectPwaPlatform();
    const standalone = isStandaloneDisplay();
    const inApp = isInAppBrowser();
    const desktopOk =
      platform !== "desktop" || getDeferredInstallPrompt() != null;
    setAlreadyInstalled(standalone);
    // Show the menu item unless in an in-app browser; desktop needs an available prompt
    setShowInstall(!inApp && (platform !== "desktop" || desktopOk));
  }, []);

  useEffect(() => {
    refreshInstall();
    const unsubPrompt = subscribeInstallPrompt(refreshInstall);
    const unsubState = subscribePwaState(refreshInstall);
    window.addEventListener("appinstalled", refreshInstall);
    return () => {
      unsubPrompt();
      unsubState();
      window.removeEventListener("appinstalled", refreshInstall);
    };
  }, [refreshInstall]);

  function open() {
    refreshInstall();
    setView("menu");
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-bg-card/80 pr-2 pl-1.5 transition hover:border-accent/50 sm:pr-3"
        aria-label={
          showInstall
            ? `${t("profile.menu")} — ${t("profile.addToHome")}`
            : t("profile.menu")
        }
      >
        <span className="relative shrink-0">
          <AvatarImage avatar={profile.avatarKey} size="sm" />
          {showInstall && !alreadyInstalled ? (
            <span
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[13px] font-black leading-none text-white ring-2 ring-bg-card"
              aria-hidden
            >
              +
            </span>
          ) : null}
        </span>
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
        view !== "closed" &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 pt-[var(--safe-top)] pb-[var(--safe-bottom)] sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label={t("profile.menu")}
            onClick={(e) => {
              if (e.target === e.currentTarget) setView("closed");
            }}
          >
            <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-bg shadow-2xl sm:max-w-md sm:rounded-3xl">
              {view === "menu" && (
                <div className="px-5 py-5">
                  <div className="mb-4 flex items-center gap-3">
                    <AvatarImage avatar={profile.avatarKey} size="md" />
                    <p className="truncate text-lg font-bold text-text">
                      {profile.displayName}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary w-full justify-start"
                      onClick={() => setView("edit")}
                    >
                      {t("profile.edit")}
                    </button>
                    {showInstall && (
                      <button
                        type="button"
                        className={clsx(
                          "btn btn-secondary relative w-full justify-start",
                          alreadyInstalled && "cursor-not-allowed opacity-45",
                        )}
                        disabled={alreadyInstalled}
                        onClick={() => !alreadyInstalled && setView("install")}
                      >
                        {t("profile.addToHome")}
                        {!alreadyInstalled && (
                          <span
                            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-black leading-none text-white"
                            aria-hidden
                          >
                            +
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {view === "edit" && (
                <ProfileSetup
                  title={t("profile.edit")}
                  submitLabel={t("profile.save")}
                  showBrand={false}
                  initial={{
                    displayName: profile.displayName,
                    avatarKey: profile.avatarKey,
                  }}
                  onCancel={() => setView("closed")}
                  onComplete={(p) => {
                    applyProfile(p);
                    setView("closed");
                  }}
                />
              )}
              {view === "install" && (
                <div className="px-5 py-5">
                  <InstallCard
                    onInstalled={() => {
                      refreshInstall();
                      setView("closed");
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost mt-3 w-full text-text-muted"
                    onClick={() => setView("menu")}
                  >
                    {t("common.back")}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
