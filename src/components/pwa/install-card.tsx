"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  detectPwaPlatform,
  type PwaPlatform,
} from "@/lib/pwa/detect";
import {
  getDeferredInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa/install-event";
import { markStandaloneSeen } from "@/lib/pwa/storage";
import { clsx } from "@/lib/utils";

export function InstallCard({
  onDismiss,
  onInstalled,
  className,
}: {
  onDismiss?: () => void;
  onInstalled?: () => void;
  className?: string;
}) {
  const { t } = useLocale();
  const [platform, setPlatform] = useState<PwaPlatform>("android");
  const [canPrompt, setCanPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlatform(detectPwaPlatform());
    setCanPrompt(getDeferredInstallPrompt() != null);
    return subscribeInstallPrompt(() => {
      setCanPrompt(getDeferredInstallPrompt() != null);
    });
  }, []);

  async function onAdd() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        markStandaloneSeen();
        onInstalled?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={clsx("text-left", className)}>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-text-dim hover:bg-white/5 hover:text-text"
          aria-label={t("pwa.close")}
        >
          ×
        </button>
      ) : null}

      <p className="text-[22px] font-bold text-text">
        {t("pwa.title")}
      </p>

      {platform === "ios" ? (
        <ol className="mt-5 flex flex-col gap-4">
          {([t("pwa.iosStep1"), t("pwa.iosStep2"), t("pwa.iosStep3")] as string[]).map(
            (step, i) => (
              <li key={i} className="flex items-center gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[16px] font-bold text-accent">
                  {i + 1}
                </span>
                <span className="text-[17px] leading-snug text-text-muted">
                  {step}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : canPrompt ? (
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={busy}
          className="btn btn-primary mt-5 h-14 min-h-14 w-full py-0 text-[18px]"
        >
          {t("pwa.androidAdd")}
        </button>
      ) : (
        <p className="mt-4 text-[17px] leading-snug text-text-muted">
          {platform === "desktop" ? t("pwa.desktopBody") : t("pwa.androidFallback")}
        </p>
      )}

      <p className="mt-5 text-[15px] leading-snug text-text-dim">
        {t("pwa.tagline")}
      </p>
    </div>
  );
}
