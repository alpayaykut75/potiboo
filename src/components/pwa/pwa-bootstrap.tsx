"use client";

import { useEffect } from "react";
import { isStandaloneDisplay } from "@/lib/pwa/detect";
import {
  captureInstallPrompt,
  clearInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa/install-event";
import { markStandaloneSeen } from "@/lib/pwa/storage";

export function PwaBootstrap() {
  useEffect(() => {
    if (isStandaloneDisplay()) markStandaloneSeen();

    function onPrompt(e: Event) {
      captureInstallPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      markStandaloneSeen();
      clearInstallPrompt();
    }

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}
