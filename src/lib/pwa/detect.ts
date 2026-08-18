export type PwaPlatform = "ios" | "android" | "desktop";

type NavigatorStand = Navigator & { standalone?: boolean };

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as NavigatorStand;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    nav.standalone === true
  );
}

export function isIosDevice(): boolean {
  const agent = ua();
  if (/iPad|iPhone|iPod/i.test(agent)) return true;
  return (
    typeof navigator !== "undefined" &&
    navigator.platform === "MacIntel" &&
    navigator.maxTouchPoints > 1
  );
}

export function isAndroidDevice(): boolean {
  return /Android/i.test(ua());
}

export function isDesktopDevice(): boolean {
  return !isIosDevice() && !isAndroidDevice() && !/Mobi|Mobile/i.test(ua());
}

export function detectPwaPlatform(): PwaPlatform {
  if (isIosDevice()) return "ios";
  if (isAndroidDevice()) return "android";
  return "desktop";
}

/** WhatsApp / Instagram / Facebook / benzeri uygulama-içi tarayıcılar */
export function isInAppBrowser(): boolean {
  const agent = ua();
  if (
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Twitter|Snapchat|Pinterest|TikTok|Bytedance|musical_ly|GSA\//i.test(
      agent,
    )
  ) {
    return true;
  }
  if (isAndroidDevice() && /; wv\)/.test(agent)) return true;
  if (isIosDevice() && !/Safari/i.test(agent) && /AppleWebKit/i.test(agent)) {
    if (/CriOS|FxiOS|EdgiOS/i.test(agent)) return false;
    return true;
  }
  return false;
}

export function canShowInstallUi(): boolean {
  return !isStandaloneDisplay() && !isInAppBrowser();
}
