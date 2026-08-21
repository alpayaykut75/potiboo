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
import { InstallHint } from "@/components/pwa/install-hint";
import { GameRulesButton } from "@/components/game-rules-panel";
import { XoxBracket } from "@/components/xox-bracket";
import { XoxMatchStrip } from "@/components/xox-match-strip";
import {
  fetchXoxGame,
  fetchXoxTournament,
  xoxMakeMove,
  xoxRematch,
  xoxSeriesContinue,
  xoxTournamentContinue,
} from "@/lib/games/xox-api";
import {
  infiniteViewport,
  markKey,
  XOX_BETWEEN_HOLD_MS,
  XOX_INFINITE_MOVE_LIMIT,
  xoxBoardLabel,
  xoxPlayerColor,
  xoxSeriesLeadText,
  type XoxGameRow,
  type XoxMark,
} from "@/lib/games/xox";
import { XoxMarkGlyph } from "@/components/xox-mark-glyph";
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
  const { href, t } = useLocale();
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<XoxGameRow | null>(null);
  const [tournament, setTournament] = useState<XoxTournamentRow | null>(null);
  const [showBracket, setShowBracket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [celebrate, setCelebrate] = useState<"match" | "champ" | null>(null);
  const [countdownSec, setCountdownSec] = useState(4);
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
      const tId = window.setTimeout(() => setCelebrate(null), 2800);
      return () => window.clearTimeout(tId);
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

  const advanceBetween = useCallback(() => {
    startTransition(async () => {
      try {
        const next = await xoxSeriesContinue(roomId);
        setGame(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Devam edilemedi");
        void refresh();
      }
    });
  }, [roomId, refresh]);

  const continuingRef = useRef(false);
  const requestContinue = useCallback(() => {
    if (continuingRef.current) return;
    continuingRef.current = true;
    advanceBetween();
  }, [advanceBetween]);

  // Between: 4 sn geri sayım + otomatik devam
  useEffect(() => {
    if (game?.status !== "between") {
      continuingRef.current = false;
      return;
    }
    const total = Math.ceil(XOX_BETWEEN_HOLD_MS / 1000);
    setCountdownSec(total);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = Math.max(
        0,
        total - Math.floor((Date.now() - started) / 1000),
      );
      setCountdownSec(left);
    }, 200);
    const auto = window.setTimeout(() => {
      requestContinue();
    }, XOX_BETWEEN_HOLD_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(auto);
    };
  }, [game?.status, game?.match_index, game?.updated_at, requestContinue]);

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
  const seriesLength = game?.series_length ?? 3;
  const matchIndex = game?.match_index ?? 1;
  const moveCount = game?.move_count ?? 0;

  const pairIds = useMemo(() => {
    const a = game?.x_player;
    const b = game?.o_player;
    if (!a || !b) return { idA: "", idB: "" };
    const pa = players.find((p) => p.profile_id === a);
    const pb = players.find((p) => p.profile_id === b);
    if (
      pa &&
      pb &&
      typeof pa.join_order === "number" &&
      typeof pb.join_order === "number" &&
      pb.join_order < pa.join_order
    ) {
      return { idA: b, idB: a };
    }
    return { idA: a, idB: b };
  }, [game?.x_player, game?.o_player, players]);

  const viewport = useMemo(() => {
    if (!isInfinite) return null;
    return infiniteViewport(game?.marks ?? {});
  }, [isInfinite, game?.marks]);

  const currentMatch =
    tournament?.current_match_key != null
      ? tournament.bracket.matches[tournament.current_match_key]
      : null;

  const playersById = useMemo(() => {
    const map: Record<string, { avatarKey: string; displayName: string }> = {};
    for (const p of players) {
      map[p.profile_id] = {
        avatarKey: p.profiles?.avatar_key ?? "panda",
        displayName: p.profiles?.display_name ?? "?",
      };
    }
    return map;
  }, [players]);

  const seriesSummary = useMemo(() => {
    if (!game?.match_history.length || !game.winner_id) return null;
    let wins = 0;
    let draws = 0;
    for (const m of game.match_history) {
      if (m.winner_id == null) draws += 1;
      else if (m.winner_id === game.winner_id) wins += 1;
    }
    return { wins, draws };
  }, [game?.match_history, game?.winner_id]);

  const nameOf = (id: string | null | undefined) =>
    players.find((p) => p.profile_id === id)?.profiles?.display_name ?? "?";

  const leadKey =
    pairIds.idA && pairIds.idB && game
      ? xoxSeriesLeadText(
          game.scores,
          pairIds.idA,
          pairIds.idB,
          nameOf(pairIds.idA),
          nameOf(pairIds.idB),
        )
      : "tie";
  const leadText =
    leadKey === "tie"
      ? t("xox.leadTie")
      : leadKey === "a"
        ? t("xox.leadAhead", { name: nameOf(pairIds.idA) })
        : t("xox.leadAhead", { name: nameOf(pairIds.idB) });

  const colorOf = (id: string | null | undefined) =>
    id && pairIds.idA && pairIds.idB
      ? xoxPlayerColor(id, pairIds.idA, pairIds.idB)
      : "#3d9dc4";

  function onCell(row: number, col: number, occupied: boolean) {
    if (!game || !isMyTurn || occupied) return;
    setError(null);
    void unlockSfx().then(() => playSfx("tap"));
    startTransition(async () => {
      try {
        const next = await xoxMakeMove(roomId, row, col);
        setGame(next);
        if (next.status === "won" || next.status === "between") {
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

  const xName = nameOf(game?.x_player) === "?" ? "✕" : nameOf(game?.x_player);
  const oName = nameOf(game?.o_player) === "?" ? "◯" : nameOf(game?.o_player);

  let statusText = "Yükleniyor…";
  if (isTournament && tourPhase === "intro") {
    statusText = "Turnuva ağacı hazır";
  } else if (isTournament && tourPhase === "intermission") {
    statusText = game?.winner_id
      ? t("xox.tourneyAdvanced", { name: nameOf(game.winner_id) })
      : "Sonraki maça hazır";
  } else if (isTournament && tourPhase === "finished") {
    statusText = `${nameOf(tournament.champion_id)} şampiyon!`;
  } else if (game?.status === "playing") {
    if (myMark == null) statusText = "İzliyorsun";
    else if (isMyTurn) statusText = "Sıra sende";
    else statusText = `Sıra: ${game.next_mark === "X" ? xName : oName}`;
  } else if (game?.status === "between") {
    statusText = "";
  } else if (game?.status === "won") {
    statusText = "";
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

  const seriesDone = game?.status === "won";
  const showBetween = game?.status === "between";

  const betweenResultText = (() => {
    if (!game || !showBetween) return "";
    const n = game.match_index;
    if (game.winner_id == null) return t("xox.matchDraw", { n });
    return t("xox.matchWon", { name: nameOf(game.winner_id), n });
  })();

  const nextXId = game?.o_player ?? null;
  const nextMatchN = (game?.match_index ?? 1) + 1;
  const isGoingExtra = nextMatchN > seriesLength;
  const nextXLine = nextXId
    ? t("xox.nextX", { n: nextMatchN, name: nameOf(nextXId) })
    : "";

  const matchProgressLabel =
    matchIndex > seriesLength
      ? t("xox.extraMatch")
      : t("xox.matchProgress", { n: matchIndex, total: seriesLength });

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
        <span className="text-center text-sm font-semibold text-accent">
          {isTournament
            ? `Toxxo · Turnuva (${tournament.size})`
            : `Toxxo · ${xoxBoardLabel(boardSize)}`}
          <span className="ml-1 font-normal text-text-dim">
            ({winLength} yan yana)
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <GameRulesButton gameId="xox" />
          {isTournament && tourPhase === "playing" ? (
            <button
              type="button"
              className="rounded-xl border border-border px-2 py-1 text-xs font-semibold text-text-muted"
              onClick={() => setShowBracket((v) => !v)}
            >
              {showBracket ? "Tahta" : "Ağaç"}
            </button>
          ) : null}
        </div>
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
          {tourPhase === "finished" && (
            <InstallHint
              completionId={`xox-tourney:${roomId}:${tournament.champion_id}`}
            />
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

          {game && pairIds.idA && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[15px] font-bold text-text">
                {matchProgressLabel}
              </p>
              <XoxMatchStrip
                seriesLength={seriesLength}
                history={game.match_history}
                currentIndex={matchIndex}
                status={game.status}
                idA={pairIds.idA}
                idB={pairIds.idB}
                playersById={playersById}
              />
              {!seriesDone && !showBetween && (
                <p className="text-[14px] font-semibold text-text-muted">
                  {leadText}
                </p>
              )}
            </div>
          )}

          {isInfinite && game?.status === "playing" && (
            <p
              className={clsx(
                "text-center text-sm font-semibold tabular-nums",
                moveCount >= XOX_INFINITE_MOVE_LIMIT - 10
                  ? "text-danger"
                  : "text-text-muted",
              )}
            >
              {t("xox.movesLeft", {
                n: moveCount,
                total: XOX_INFINITE_MOVE_LIMIT,
              })}
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
              const color = colorOf(id);
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
                  <span aria-label={mark}>
                    <XoxMarkGlyph mark={mark} color={color} size={28} />
                  </span>
                </div>
              );
            })}
          </div>

          {statusText ? (
            <p className="text-center text-lg font-bold text-text">
              {statusText}
            </p>
          ) : null}

          <div
            className={clsx(
              "relative mx-auto w-full overflow-x-auto",
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
              {cells.map(({ row, col, mark }) => {
                const ownerId =
                  mark === "X"
                    ? game?.x_player
                    : mark === "O"
                      ? game?.o_player
                      : null;
                const cellColor = ownerId ? colorOf(ownerId) : undefined;
                return (
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
                      "flex aspect-square items-center justify-center border-2 border-border-strong bg-bg-card transition",
                      isInfinite || boardSize === 5
                        ? "rounded-lg"
                        : "rounded-2xl",
                      isMyTurn && !mark && game?.status === "playing"
                        ? "hover:border-accent hover:bg-accent/10"
                        : "opacity-90",
                    )}
                  >
                    {mark ? (
                      <XoxMarkGlyph
                        mark={mark}
                        color={cellColor ?? "#3d9dc4"}
                        size={
                          isInfinite || boardSize === 5 ? 22 : 36
                        }
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {showBetween && game && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-[#041018]/88 p-4 backdrop-blur-sm">
                <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                  <p className="text-2xl font-extrabold text-text">
                    {betweenResultText}
                  </p>
                  <XoxMatchStrip
                    seriesLength={seriesLength}
                    history={game.match_history}
                    currentIndex={matchIndex}
                    status="between"
                    idA={pairIds.idA}
                    idB={pairIds.idB}
                    playersById={playersById}
                  />
                  <p className="text-[15px] font-semibold text-text-muted">
                    {leadText}
                  </p>
                  {isGoingExtra ? (
                    <p className="text-[15px] font-bold text-accent">
                      {t("xox.extraSeries")}
                    </p>
                  ) : null}
                  <p className="text-lg font-extrabold text-accent">
                    {nextXLine}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary mt-1 w-full"
                    disabled={pending}
                    onClick={() => requestContinue()}
                  >
                    {t("xox.continue")} · {countdownSec}
                  </button>
                </div>
              </div>
            )}

            {seriesDone && game && !isTournament && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-[#041018]/90 p-4 backdrop-blur-sm">
                <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                  <p className="text-2xl font-extrabold text-text">
                    {t("xox.seriesWon", { name: nameOf(game.winner_id) })}
                  </p>
                  <XoxMatchStrip
                    seriesLength={seriesLength}
                    history={game.match_history}
                    currentIndex={matchIndex}
                    status="won"
                    idA={pairIds.idA}
                    idB={pairIds.idB}
                    playersById={playersById}
                  />
                  {seriesSummary ? (
                    <p className="text-[15px] font-semibold text-text-muted">
                      {seriesSummary.draws > 0
                        ? t("xox.seriesSummary", {
                            wins: seriesSummary.wins,
                            draws: seriesSummary.draws,
                          })
                        : t("xox.seriesSummaryWinsOnly", {
                            wins: seriesSummary.wins,
                          })}
                    </p>
                  ) : null}
                  {isHost ? (
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      disabled={pending}
                      onClick={onRematch}
                    >
                      {t("xox.playAgain")}
                    </button>
                  ) : (
                    <p className="text-sm text-text-muted">
                      Kurucu yeniden başlatabilir.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary w-full"
                    onClick={() => router.push(href("/"))}
                  >
                    {t("xox.backHome")}
                  </button>
                  <InstallHint
                    completionId={`xox:${roomId}:${game.updated_at}`}
                  />
                </div>
              </div>
            )}

            {seriesDone && game && isTournament && tourPhase === "playing" && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-[#041018]/90 p-4 backdrop-blur-sm">
                <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                  <p className="text-2xl font-extrabold text-text">
                    {t("xox.tourneyAdvanced", { name: nameOf(game.winner_id) })}
                  </p>
                  <XoxMatchStrip
                    seriesLength={seriesLength}
                    history={game.match_history}
                    currentIndex={matchIndex}
                    status="won"
                    idA={pairIds.idA}
                    idB={pairIds.idB}
                    playersById={playersById}
                  />
                  <p className="text-sm text-text-muted">
                    {t("xox.waitBracket")}
                  </p>
                </div>
              </div>
            )}
          </div>
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
