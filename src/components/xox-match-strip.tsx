"use client";

import { AvatarImage } from "@/components/avatar-image";
import { xoxPlayerColor, type XoxMatchResult } from "@/lib/games/xox";
import { clsx } from "@/lib/utils";

type PlayerInfo = {
  avatarKey: string;
  displayName: string;
};

export function XoxMatchStrip({
  seriesLength,
  history,
  currentIndex,
  status,
  idA,
  idB,
  playersById,
}: {
  seriesLength: number;
  history: XoxMatchResult[];
  /** 1-based current match index */
  currentIndex: number;
  status: "playing" | "won" | "draw" | "between";
  idA: string;
  idB: string;
  playersById: Record<string, PlayerInfo>;
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
          const winnerId = entry?.winner_id ?? null;
          const isDraw = Boolean(entry) && winnerId == null;
          const color =
            winnerId != null ? xoxPlayerColor(winnerId, idA, idB) : undefined;
          const info = winnerId ? playersById[winnerId] : undefined;
          const initial =
            info?.displayName?.trim().charAt(0)?.toUpperCase() ?? "?";

          return (
            <div key={n} className="flex flex-col items-center gap-1">
              <div
                className={clsx(
                  "flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border-2",
                  !entry && "border-border/50 bg-bg-card/40",
                  isDraw && "border-white/25 bg-white/10 text-text-dim",
                  winnerId && "bg-bg-card",
                  isCurrent &&
                    "border-accent shadow-[0_0_0_1px_rgba(61,157,196,0.5)]",
                  isExtra && !entry && "border-dashed",
                )}
                style={
                  winnerId && color
                    ? { borderColor: color }
                    : undefined
                }
                aria-label={`Maç ${n}`}
              >
                {!entry ? null : isDraw ? (
                  <span className="text-lg font-bold leading-none text-text-dim">
                    –
                  </span>
                ) : info ? (
                  <AvatarImage
                    avatar={info.avatarKey}
                    size="xs"
                    className="!ring-0"
                  />
                ) : (
                  <span
                    className="text-sm font-extrabold"
                    style={{ color }}
                  >
                    {initial}
                  </span>
                )}
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
