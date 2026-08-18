import { describe, expect, it } from "vitest";
import { isInAppBrowser } from "./detect";

function withUa(agent: string, run: () => void) {
  const prev = (globalThis as { navigator?: Navigator }).navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: agent,
      platform: "Linux",
      maxTouchPoints: 0,
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: prev,
    });
  }
}

describe("isInAppBrowser", () => {
  it("detects WhatsApp / Instagram / Facebook", () => {
    withUa(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) WhatsApp/24.0",
      () => expect(isInAppBrowser()).toBe(true),
    );
    withUa(
      "Mozilla/5.0 (Linux; Android 14) Instagram 300.0.0",
      () => expect(isInAppBrowser()).toBe(true),
    );
    withUa(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 [FB_IAB/FB4A;FBAV/1.0]",
      () => expect(isInAppBrowser()).toBe(true),
    );
  });

  it("lets Safari and Chrome through", () => {
    withUa(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      () => expect(isInAppBrowser()).toBe(false),
    );
    withUa(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
      () => expect(isInAppBrowser()).toBe(false),
    );
  });
});
