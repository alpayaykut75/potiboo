"use client";

import { useEffect, useState } from "react";
import { InstallCard } from "@/components/pwa/install-card";
import {
  canShowInstallUi,
  isDesktopDevice,
  isStandaloneDisplay,
} from "@/lib/pwa/detect";
import {
  dismissInstallHint,
  markGameCompleted,
  markHintShown,
  shouldShowInstallHint,
} from "@/lib/pwa/storage";

export function InstallHint({ completionId }: { completionId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    markGameCompleted(completionId);
    if (isStandaloneDisplay() || isDesktopDevice() || !canShowInstallUi()) {
      return;
    }
    if (!shouldShowInstallHint(completionId)) return;
    markHintShown(completionId);
    setOpen(true);
  }, [completionId]);

  if (!open) return null;

  return (
    <InstallCard
      className="mt-3"
      onDismiss={() => {
        dismissInstallHint(completionId);
        setOpen(false);
      }}
    />
  );
}
