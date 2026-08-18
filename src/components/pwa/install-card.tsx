"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { IosShareIcon } from "@/components/pwa/ios-share-icon";
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
    <div
      className={clsx(
        "card relative px-4 py-3.5 text-left",
        className,
      )}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-text-dim hover:bg-white/5 hover:text-text"
          aria-label={t("pwa.close")}
        >
          ×
        </button>
      ) : null}

      <p className={clsx("pr-8 text-[16px] font-bold text-text")}>
        {t("pwa.title")}
      </p>

      {platform === "ios" ? (
        <div className="mt-2 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <IosShareIcon />
          </span>
          <p className="text-[14px] leading-snug text-text-muted">
            {t("pwa.iosBody")}
          </p>
        </div>
      ) : canPrompt ? (
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={busy}
          className="btn btn-primary mt-3 h-11 min-h-11 w-full py-0 text-[16px]"
        >
          {t("pwa.androidAdd")}
        </button>
      ) : (
        <p className="mt-2 text-[14px] leading-snug text-text-muted">
          {platform === "desktop" ? t("pwa.desktopBody") : t("pwa.androidFallback")}
        </p>
      )}

      <p className="mt-2.5 text-[13px] leading-snug text-text-dim">
        {t("pwa.tagline")}
      </p>
    </div>
  );
}
