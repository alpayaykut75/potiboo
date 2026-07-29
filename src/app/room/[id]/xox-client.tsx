"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import {
  fetchXoxGame,
  xoxMakeMove,
  xoxRematch,
} from "@/lib/games/xox-api";
import {
  infiniteViewport,
  markKey,
  xoxBoardLabel,
  type XoxGameRow,
  type XoxMark,
} from "@/lib/games/xox";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

export function XoxGameClient({
  roomId,
  initialRoom,
  initialPlayers,
}: {
  roomId: string;
  initialRoom: Room;
  initialPlayers: RoomPlayerWithProfile[];
}) {
  const { profile } = useProfile();
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<XoxGameRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, nextGame] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchXoxGame(roomId),
    ]);
    if (nextRoom) setRoom(nextRoom);
    setPlayers(nextPlayers);
    setGame(nextGame);
  }, [roomId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "Yüklenemedi"),
    );
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`xox:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "xox_games",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    const poll = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  const myMark =
    game?.x_player === profile.userId
      ? "X"
      : game?.o_player === profile.userId
        ? "O"
        : null;
  const isMyTurn =
    game?.status === "playing" && myMark != null && game.next_mark === myMark;
  const isHost = room.host_id === profile.userId;
  const isInfinite = game?.board_size === 0;
  const boardSize = game?.board_size ?? 3;
  const winLength =
    game?.win_length ??
    (boardSize === 0 ? 5 : boardSize === 5 ? 4 : 3);

  const viewport = useMemo(() => {
    if (!isInfinite) return null;
    return infiniteViewport(game?.marks ?? {});
  }, [isInfinite, game?.marks]);

  function onCell(row: number, col: number, occupied: boolean) {
    if (!game || !isMyTurn || occupied) return;
    setError(null);
    void unlockSfx().then(() => playSfx("tap"));
    startTransition(async () => {
      try {
        const next = await xoxMakeMove(roomId, row, col);
        setGame(next);
        if (next.status === "won" || next.status === "draw") {
          playSfx("countdownGo");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Hamle yapılamadı");
        void refresh();
      }
    });
  }

  function onRematch() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await xoxRematch(roomId);
        setGame(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Yeniden başlatılamadı");
      }
    });
  }

  const xName =
    players.find((p) => p.profile_id === game?.x_player)?.profiles
      ?.display_name ?? "X";
  const oName =
    players.find((p) => p.profile_id === game?.o_player)?.profiles
      ?.display_name ?? "O";

  let statusText = "Yükleniyor…";
  if (game?.status === "playing") {
    statusText = isMyTurn
      ? "Sıra sende"
      : `Sıra: ${game.next_mark === "X" ? xName : oName}`;
  } else if (game?.status === "draw") {
    statusText = "Berabere!";
  } else if (game?.status === "won") {
    const winnerName =
      players.find((p) => p.profile_id === game.winner_id)?.profiles
        ?.display_name ?? "Kazanan";
    statusText =
      game.winner_id === profile.userId ? "Kazandın!" : `${winnerName} kazandı`;
  }

  const fixedCells: { row: number; col: number; mark: XoxMark }[] = [];
  if (!isInfinite && game) {
    const size = boardSize === 0 ? 3 : boardSize;
    for (let i = 0; i < size * size; i++) {
      fixedCells.push({
        row: Math.floor(i / size),
        col: i % size,
        mark: (game.board[i] as XoxMark) || "",
      });
    }
  }

  const infiniteCells: { row: number; col: number; mark: XoxMark }[] = [];
  let cols = boardSize === 0 ? 7 : boardSize;
  if (isInfinite && viewport) {
    cols = viewport.maxC - viewport.minC + 1;
    for (let r = viewport.minR; r <= viewport.maxR; r++) {
      for (let c = viewport.minC; c <= viewport.maxC; c++) {
        infiniteCells.push({
          row: r,
          col: c,
          mark: game?.marks[markKey(r, c)] ?? "",
        });
      }
    }
  }

  const cells = isInfinite ? infiniteCells : fixedCells;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
          onClick={() => router.push("/")}
        >
          ← Çık
        </button>
        <span className="text-sm font-semibold text-accent">
          XOX · {xoxBoardLabel(boardSize)}
          <span className="ml-1 font-normal text-text-dim">
            ({winLength} yan yana)
          </span>
        </span>
      </header>

      <div className="flex items-center justify-center gap-6">
        {(
          [
            { mark: "X" as const, id: game?.x_player },
            { mark: "O" as const, id: game?.o_player },
          ] as const
        ).map(({ mark, id }) => {
          const p = players.find((pl) => pl.profile_id === id);
          const turn =
            game?.status === "playing" && game.next_mark === mark;
          return (
            <div
              key={mark}
              className={clsx(
                "flex flex-col items-center gap-2 rounded-2xl px-3 py-2",
                turn && "ring-2 ring-accent",
              )}
            >
              <AvatarImage
                avatar={p?.profiles?.avatar_key ?? "panda"}
                size="lg"
              />
              <p className="max-w-[6rem] truncate text-sm font-bold text-text">
                {p?.profiles?.display_name ?? mark}
              </p>
              <span
                className={clsx(
                  "font-mono text-lg font-extrabold",
                  mark === "X" ? "text-accent" : "text-[#5bb8a8]",
                )}
              >
                {mark}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-center text-lg font-bold text-text">{statusText}</p>

      <div
        className={clsx(
          "mx-auto w-full overflow-x-auto",
          isInfinite || boardSize === 5 ? "max-w-md" : "max-w-xs",
        )}
      >
        <div
          className={clsx(
            "mx-auto grid gap-1 sm:gap-1.5",
            isInfinite ? "min-w-[16rem]" : "",
          )}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {cells.map(({ row, col, mark }) => (
            <button
              key={`${row},${col}`}
              type="button"
              disabled={
                pending ||
                !isMyTurn ||
                Boolean(mark) ||
                game?.status !== "playing"
              }
              onClick={() => onCell(row, col, Boolean(mark))}
              className={clsx(
                "aspect-square border-2 border-border-strong bg-bg-card font-extrabold transition",
                isInfinite || boardSize === 5
                  ? "rounded-lg text-base sm:rounded-xl sm:text-xl"
                  : "rounded-2xl text-4xl",
                isMyTurn && !mark && game?.status === "playing"
                  ? "hover:border-accent hover:bg-accent/10"
                  : "opacity-90",
                mark === "X" && "text-accent",
                mark === "O" && "text-[#5bb8a8]",
              )}
            >
              {mark || ""}
            </button>
          ))}
        </div>
      </div>

      {game && game.status !== "playing" && isHost && (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending}
          onClick={onRematch}
        >
          Yeniden oyna
        </button>
      )}

      {game && game.status !== "playing" && !isHost && (
        <p className="text-center text-sm text-text-muted">
          Kurucu yeniden başlatabilir.
        </p>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
