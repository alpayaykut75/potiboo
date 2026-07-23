"use client";

import type { CSSProperties } from "react";

const PIECES = [
  { left: "8%", delay: "0s", color: "#3d9dc4", w: 8, h: 12, cx: "-18px" },
  { left: "18%", delay: "0.15s", color: "#5bb8a8", w: 10, h: 10, cx: "22px" },
  { left: "28%", delay: "0.05s", color: "#e8b84a", w: 7, h: 14, cx: "-10px" },
  { left: "38%", delay: "0.25s", color: "#3ecf8e", w: 9, h: 9, cx: "28px" },
  { left: "48%", delay: "0.1s", color: "#4aafd6", w: 8, h: 12, cx: "-24px" },
  { left: "58%", delay: "0.3s", color: "#c47bb8", w: 10, h: 8, cx: "14px" },
  { left: "68%", delay: "0.08s", color: "#3d9dc4", w: 7, h: 13, cx: "-16px" },
  { left: "78%", delay: "0.22s", color: "#e8b84a", w: 9, h: 9, cx: "20px" },
  { left: "88%", delay: "0.18s", color: "#5bb8a8", w: 8, h: 11, cx: "-12px" },
  { left: "12%", delay: "0.4s", color: "#3ecf8e", w: 6, h: 10, cx: "18px" },
  { left: "52%", delay: "0.35s", color: "#4aafd6", w: 8, h: 8, cx: "-20px" },
  { left: "72%", delay: "0.45s", color: "#c47bb8", w: 7, h: 12, cx: "10px" },
] as const;

export function ConfettiBurst() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {PIECES.map((p, i) => {
        const style = {
          left: p.left,
          width: p.w,
          height: p.h,
          backgroundColor: p.color,
          animationDelay: p.delay,
          ["--cx" as string]: p.cx,
        } as CSSProperties;
        return (
          <span
            key={i}
            className="animate-confetti absolute top-0 rounded-sm"
            style={style}
          />
        );
      })}
    </div>
  );
}
