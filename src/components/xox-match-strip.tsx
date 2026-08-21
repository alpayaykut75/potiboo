"use client";

import {
  XOX_MARK_SYMBOL,
  xoxPlayerColor,
  type XoxMatchResult,
} from "@/lib/games/xox";
import { clsx } from "@/lib/utils";

export function XoxMatchStrip({
  seriesLength,
  history,
  currentIndex,
  status,
  idA,
  idB,
}: {
  seriesLength: number;
  history: XoxMatchResult[];
  /** 1-based current match index */
  currentIndex: number;
  status: "playing" | "won" | "draw" | "between";
  idA: string;
  idB: string;
}) {
  const slotCount = Math.max(seriesLength, history.length, currentIndex);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {Array.from({ length: slotCount }, (_, i) => {
          const n = i + 1;
          const entry = history[i];
          const isCurrent =
            status === "playing" && n === currentIndex && !entry;
          const isExtra = n > seriesLength;

          let content: string | null = null;
          let color: string | undefined;
          let filled = false;

          if (entry) {
            filled = true;
            if (entry.winner_id == null) {
              content = "–";
              color = undefined;
            } else {
              const mark =
                entry.winner_id === entry.x_player
                  ? "X"
                  : entry.winner_id === entry.o_player
                    ? "O"
                    : null;
              content = mark ? XOX_MARK_SYMBOL[mark] : "•";
              color = xoxPlayerColor(entry.winner_id, idA, idB);
            }
          }

          return (
            <div key={n} className="flex flex-col items-center gap-1">
              <div
                className={clsx(
                  "flex h-9 w-9 items-center justify-center rounded-lg border-2 text-lg font-black",
                  !filled && "border-border/50 bg-bg-card/40 text-transparent",
                  filled && entry?.winner_id == null && "border-white/25 bg-white/10 text-text-dim",
                  filled && entry?.winner_id != null && "border-transparent bg-bg-card",
                  isCurrent && "border-accent shadow-[0_0_0_1px_rgba(61,157,196,0.5)]",
                  isExtra && !filled && "border-dashed",
                )}
                style={
                  filled && color
                    ? { color, borderColor: `${color}66` }
                    : undefined
                }
                aria-label={`Maç ${n}`}
              >
                {content ?? "·"}
              </div>
              <span className="text-[10px] font-semibold text-text-dim">
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
