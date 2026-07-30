"use client";

import { AvatarImage } from "@/components/avatar-image";
import type { XoxTournamentBracket } from "@/lib/games/xox-tournament";
import type { RoomPlayerWithProfile } from "@/lib/rooms/types";
import { clsx } from "@/lib/utils";

function Slot({
  playerId,
  players,
  winnerId,
  active,
}: {
  playerId: string | null;
  players: RoomPlayerWithProfile[];
  winnerId: string | null;
  active?: boolean;
}) {
  const p = players.find((x) => x.profile_id === playerId);
  const lost = winnerId != null && playerId != null && winnerId !== playerId;
  return (
    <div
      className={clsx(
        "flex min-h-[2.1rem] w-full items-center gap-1.5 rounded-lg border px-2 py-1",
        active ? "border-accent bg-accent/15" : "border-border bg-bg-card",
        lost && "opacity-35",
        winnerId === playerId && "ring-1 ring-accent",
      )}
    >
      {playerId ? (
        <>
          <AvatarImage
            avatar={p?.profiles?.avatar_key ?? "panda"}
            size="xs"
          />
          <span className="truncate text-[11px] font-semibold text-text sm:text-xs">
            {p?.profiles?.display_name ?? "?"}
          </span>
        </>
      ) : (
        <span className="w-full text-center text-xs text-text-dim">—</span>
      )}
    </div>
  );
}

function MatchCol({
  title,
  playerA,
  playerB,
  winner,
  players,
  active,
  align = "center",
}: {
  title: string;
  playerA: string | null;
  playerB: string | null;
  winner: string | null;
  players: RoomPlayerWithProfile[];
  active: boolean;
  align?: "left" | "right" | "center";
}) {
  return (
    <div
      className={clsx(
        "flex w-[6.75rem] flex-col gap-1 sm:w-[7.5rem]",
        active && "z-10",
      )}
    >
      <p
        className={clsx(
          "text-[10px] font-semibold tracking-wide text-text-dim uppercase",
          align === "left" && "text-left",
          align === "right" && "text-right",
          align === "center" && "text-center",
        )}
      >
        {title}
      </p>
      <div
        className={clsx(
          "flex flex-col gap-1 rounded-xl p-1",
          active && "ring-2 ring-accent/70",
        )}
      >
        <Slot
          playerId={playerA}
          players={players}
          winnerId={winner}
          active={active}
        />
        <Slot
          playerId={playerB}
          players={players}
          winnerId={winner}
          active={active}
        />
      </div>
    </div>
  );
}

/** Sol/sağ yarıyı finale bağlayan çizgi */
function Bridge({ side }: { side: "left" | "right" }) {
  return (
    <div
      className={clsx(
        "flex h-16 w-4 shrink-0 items-center sm:w-6",
        side === "right" && "flex-row-reverse",
      )}
      aria-hidden
    >
      <div className="h-10 w-px bg-border-strong" />
      <div className="h-px flex-1 bg-border-strong" />
    </div>
  );
}

export function XoxBracket({
  bracket,
  size,
  currentMatchKey,
  players,
}: {
  bracket: XoxTournamentBracket;
  size: 4 | 8;
  currentMatchKey: string | null;
  players: RoomPlayerWithProfile[];
}) {
  const m = bracket.matches;
  const active = (key: string) => currentMatchKey === key;

  if (size === 4) {
    return (
      <div className="flex w-full items-center justify-center gap-0 overflow-x-auto px-1 py-3">
        <MatchCol
          title="Yarı final"
          playerA={m.LSF?.player_a ?? null}
          playerB={m.LSF?.player_b ?? null}
          winner={m.LSF?.winner ?? null}
          players={players}
          active={active("LSF")}
          align="right"
        />
        <Bridge side="left" />
        <MatchCol
          title="Final"
          playerA={m.F?.player_a ?? null}
          playerB={m.F?.player_b ?? null}
          winner={m.F?.winner ?? null}
          players={players}
          active={active("F")}
        />
        <Bridge side="right" />
        <MatchCol
          title="Yarı final"
          playerA={m.RSF?.player_a ?? null}
          playerB={m.RSF?.player_b ?? null}
          winner={m.RSF?.winner ?? null}
          players={players}
          active={active("RSF")}
          align="left"
        />
      </div>
    );
  }

  return (
    <div className="flex w-full items-center justify-center gap-0 overflow-x-auto px-1 py-3">
      {/* Sol yarı */}
      <div className="flex flex-col gap-6">
        <MatchCol
          title="Çeyrek"
          playerA={m.LQF1?.player_a ?? null}
          playerB={m.LQF1?.player_b ?? null}
          winner={m.LQF1?.winner ?? null}
          players={players}
          active={active("LQF1")}
          align="right"
        />
        <MatchCol
          title="Çeyrek"
          playerA={m.LQF2?.player_a ?? null}
          playerB={m.LQF2?.player_b ?? null}
          winner={m.LQF2?.winner ?? null}
          players={players}
          active={active("LQF2")}
          align="right"
        />
      </div>
      <div className="mx-0.5 flex flex-col justify-center gap-8" aria-hidden>
        <div className="flex h-8 w-3 items-center sm:w-4">
          <div className="h-px flex-1 bg-border-strong" />
        </div>
        <div className="flex h-8 w-3 items-center sm:w-4">
          <div className="h-px flex-1 bg-border-strong" />
        </div>
      </div>
      <MatchCol
        title="Yarı"
        playerA={m.LSF?.player_a ?? null}
        playerB={m.LSF?.player_b ?? null}
        winner={m.LSF?.winner ?? null}
        players={players}
        active={active("LSF")}
        align="right"
      />
      <Bridge side="left" />
      <MatchCol
        title="Final"
        playerA={m.F?.player_a ?? null}
        playerB={m.F?.player_b ?? null}
        winner={m.F?.winner ?? null}
        players={players}
        active={active("F")}
      />
      <Bridge side="right" />
      <MatchCol
        title="Yarı"
        playerA={m.RSF?.player_a ?? null}
        playerB={m.RSF?.player_b ?? null}
        winner={m.RSF?.winner ?? null}
        players={players}
        active={active("RSF")}
        align="left"
      />
      <div className="mx-0.5 flex flex-col justify-center gap-8" aria-hidden>
        <div className="flex h-8 w-3 items-center sm:w-4">
          <div className="h-px flex-1 bg-border-strong" />
        </div>
        <div className="flex h-8 w-3 items-center sm:w-4">
          <div className="h-px flex-1 bg-border-strong" />
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <MatchCol
          title="Çeyrek"
          playerA={m.RQF1?.player_a ?? null}
          playerB={m.RQF1?.player_b ?? null}
          winner={m.RQF1?.winner ?? null}
          players={players}
          active={active("RQF1")}
          align="left"
        />
        <MatchCol
          title="Çeyrek"
          playerA={m.RQF2?.player_a ?? null}
          playerB={m.RQF2?.player_b ?? null}
          winner={m.RQF2?.winner ?? null}
          players={players}
          active={active("RQF2")}
          align="left"
        />
      </div>
    </div>
  );
}
