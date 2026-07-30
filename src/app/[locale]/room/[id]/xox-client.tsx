"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/components/i18n/locale-provider";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import { ConfettiBurst } from "@/components/confetti";
import { XoxBracket } from "@/components/xox-bracket";
import {
  fetchXoxGame,
  fetchXoxTournament,
  xoxMakeMove,
  xoxRematch,
  xoxTournamentContinue,
} from "@/lib/games/xox-api";
import {
  infiniteViewport,
  markKey,
  xoxBoardLabel,
  type XoxGameRow,
  type XoxMark,
} from "@/lib/games/xox";
import {
  matchLabel,
  type XoxTournamentRow,
} from "@/lib/games/xox-tournament";
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
  const { href } = useLocale();
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<XoxGameRow | null>(null);
  const [tournament, setTournament] = useState<XoxTournamentRow | null>(null);
  const [showBracket, setShowBracket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [celebrate, setCelebrate] = useState<"match" | "champ" | null>(null);
  const celebrateKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, nextGame, nextTour] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchXoxGame(roomId),
      fetchXoxTournament(roomId),
    ]);
    if (nextRoom) setRoom(nextRoom);
    setPlayers(nextPlayers);
    setGame(nextGame);
    setTournament(nextTour);
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
          table: "xox_tournaments",
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

  // Turnuva kutlaması
  useEffect(() => {
    if (!tournament) return;
    if (tournament.phase === "intermission" && game?.winner_id) {
      const key = `m:${tournament.current_match_key}:${game.winner_id}:${game.updated_at}`;
      if (celebrateKey.current === key) return;
      celebrateKey.current = key;
      setCelebrate("match");
      void unlockSfx().then(() => {
        playSfx("countdownGo");
        playSfx("confetti");
      });
      const t = window.setTimeout(() => setCelebrate(null), 2800);
      return () => window.clearTimeout(t);
    }
    if (tournament.phase === "finished" && tournament.champion_id) {
      const key = `c:${tournament.champion_id}`;
      if (celebrateKey.current === key) return;
      celebrateKey.current = key;
      setCelebrate("champ");
      void unlockSfx().then(() => playSfx("confetti"));
    }
  }, [
    tournament,
    tournament?.phase,
    tournament?.champion_id,
    tournament?.current_match_key,
    game?.winner_id,
    game?.updated_at,
  ]);

  const isTournament = tournament != null;
  const tourPhase = tournament?.phase;
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

  const currentMatch =
    tournament?.current_match_key != null
      ? tournament.bracket.matches[tournament.current_match_key]
      : null;

  const nameOf = (id: string | null | undefined) =>
    players.find((p) => p.profile_id === id)?.profiles?.display_name ?? "?";

  function onCell(row: number, col: number, occupied: boolean) {
    if (!game || !isMyTurn || occupied) return;
    setError(null);
    void unlockSfx().then(() => playSfx("tap"));
    startTransition(async () => {
      try {
        const next = await xoxMakeMove(roomId, row, col);
        setGame(next);
        if (next.status === "won") {
          void refresh();
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

  function onContinue() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await xoxTournamentContinue(roomId);
        setTournament(next);
        setShowBracket(false);
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Devam edilemedi");
      }
    });
  }

  const xName = nameOf(game?.x_player) === "?" ? "X" : nameOf(game?.x_player);
  const oName = nameOf(game?.o_player) === "?" ? "O" : nameOf(game?.o_player);

  let statusText = "Yükleniyor…";
  if (isTournament && tourPhase === "intro") {
    statusText = "Turnuva ağacı hazır";
  } else if (isTournament && tourPhase === "intermission") {
    statusText = game?.winner_id
      ? `${nameOf(game.winner_id)} üst tura çıktı`
      : "Sonraki maça hazır";
  } else if (isTournament && tourPhase === "finished") {
    statusText = `${nameOf(tournament.champion_id)} şampiyon!`;
  } else if (game?.status === "playing") {
    if (myMark == null) statusText = "İzliyorsun";
    else if (isMyTurn) statusText = "Sıra sende";
    else statusText = `Sıra: ${game.next_mark === "X" ? xName : oName}`;
  } else if (game?.status === "draw") {
    statusText = "Berabere — devam";
  } else if (game?.status === "won") {
    statusText =
      game.winner_id === profile.userId
        ? "Kazandın!"
        : `${nameOf(game.winner_id)} kazandı`;
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

  const bracketScreen =
    isTournament &&
    (tourPhase === "intro" ||
      tourPhase === "intermission" ||
      tourPhase === "finished" ||
      (tourPhase === "playing" && showBracket));

  return (
    <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-5 py-6">
      {celebrate && <ConfettiBurst />}
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
          onClick={() => router.push(href("/"))}
        >
          ← Çık
        </button>
        <span className="text-sm font-semibold text-accent">
          {isTournament
            ? `XOX · Turnuva (${tournament.size})`
            : `XOX · ${xoxBoardLabel(boardSize)}`}
          {!isTournament && (
            <span className="ml-1 font-normal text-text-dim">
              ({winLength} yan yana)
            </span>
          )}
        </span>
        {isTournament && tourPhase === "playing" ? (
          <button
            type="button"
            className="rounded-xl border border-border px-2 py-1 text-xs font-semibold text-text-muted"
            onClick={() => setShowBracket((v) => !v)}
          >
            {showBracket ? "Tahta" : "Ağaç"}
          </button>
        ) : (
          <span className="w-12" />
        )}
      </header>

      {bracketScreen && tournament && (
        <section className="space-y-3">
          <XoxBracket
            bracket={tournament.bracket}
            size={tournament.size}
            currentMatchKey={tournament.current_match_key}
            players={players}
          />
          <p className="text-center text-lg font-bold text-text">{statusText}</p>
          {tourPhase === "finished" && (
            <p className="text-center text-sm text-accent">
              {nameOf(tournament.champion_id)} turnuvayı kazandı
            </p>
          )}
          {(tourPhase === "intro" || tourPhase === "intermission") &&
            (isHost ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={pending}
                onClick={onContinue}
              >
                {pending
                  ? "…"
                  : tourPhase === "intro"
                    ? "İlk maçı başlat"
                    : "Sonraki maça geç"}
              </button>
            ) : (
              <p className="text-center text-sm text-text-muted">
                Kurucu maçı başlatacak…
              </p>
            ))}
        </section>
      )}

      {!bracketScreen && (
        <>
          {isTournament && currentMatch && (
            <p className="text-center text-sm font-semibold text-text">
              {matchLabel(currentMatch.key)} · {nameOf(currentMatch.player_a)}{" "}
              vs {nameOf(currentMatch.player_b)}
            </p>
          )}

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
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
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

          {!isTournament && game && game.status !== "playing" && isHost && (
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={pending}
              onClick={onRematch}
            >
              Yeniden oyna
            </button>
          )}

          {!isTournament && game && game.status !== "playing" && !isHost && (
            <p className="text-center text-sm text-text-muted">
              Kurucu yeniden başlatabilir.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
