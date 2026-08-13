"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/components/i18n/locale-provider";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import { ConfettiBurst } from "@/components/confetti";
import {
  fetchIntervalGame,
  fetchIntervalHand,
  intervalBet,
  intervalContinue,
  intervalIntend,
  intervalPass,
  intervalRematch,
} from "@/lib/games/interval-api";
import {
  canStake,
  colorHex,
  leaders,
  rangeOf,
  stakeOptions,
  type IntervalGameRow,
  type IntervalHandRow,
  type IntervalLastEvent,
  type IntervalTile,
} from "@/lib/games/interval";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

type PotFx = {
  key: number;
  kind: "in" | "out" | "hit";
  amount: number;
};

type RevealStep = "put" | "card";

function TileView({
  tile,
  large,
  mini,
  className,
}: {
  tile: IntervalTile;
  large?: boolean;
  mini?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center font-bold text-[#041018] shadow-sm",
        mini
          ? "h-7 w-6 rounded-md text-[12px]"
          : large
            ? "h-24 w-20 rounded-2xl text-[36px]"
            : "h-16 w-14 rounded-2xl text-[26px]",
        className,
      )}
      style={{ backgroundColor: colorHex(tile.color) }}
    >
      {tile.value}
    </div>
  );
}

function seatStyle(index: number, total: number): CSSProperties {
  const n = Math.max(total, 1);
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / n;
  const rx = 41;
  const ry = 37;
  const x = 50 + Math.cos(angle) * rx;
  const y = 50 + Math.sin(angle) * ry;
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
  };
}

function potFxFromEvent(ev: IntervalLastEvent): Omit<PotFx, "key"> | null {
  if (!ev) return null;
  // Miss: +stake zaten "put" adımında; kartta sadece tutturma (ortadan çıkış)
  if (ev.kind === "hit") return { kind: "hit", amount: ev.payout };
  return null;
}

export function IntervalGameClient({
  roomId,
  initialRoom,
  initialPlayers,
}: {
  roomId: string;
  initialRoom: Room;
  initialPlayers: RoomPlayerWithProfile[];
}) {
  const { profile } = useProfile();
  const { t, href } = useLocale();
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<IntervalGameRow | null>(null);
  const [hand, setHand] = useState<IntervalHandRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [stake, setStake] = useState<number | null>(null);
  const [potFx, setPotFx] = useState<PotFx | null>(null);
  const [fxTick, setFxTick] = useState(0);
  const [revealStep, setRevealStep] = useState<RevealStep>("put");

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, nextGame, nextHand] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchIntervalGame(roomId),
      fetchIntervalHand(roomId),
    ]);
    if (nextRoom) setRoom(nextRoom);
    setPlayers(nextPlayers);
    setGame(nextGame);
    setHand(nextHand);
  }, [roomId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : t("room.loadFailed")),
    );
  }, [refresh, t]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`interval:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "interval_games",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "interval_hands",
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
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  useEffect(() => {
    if (game?.phase === "turn") {
      setStake(game.intent_amount);
    }
  }, [game?.phase, game?.intent_amount, game?.turn_profile_id]);

  useEffect(() => {
    if (!game?.last_event || game.phase !== "reveal") return;
    const fx = potFxFromEvent(game.last_event);
    if (!fx) return;
    setFxTick((n) => n + 1);
    setPotFx({ ...fx, key: Date.now() });
  }, [game?.updated_at, game?.last_event, game?.phase]);

  // Reveal: önce koyma, sonra taş — bekleyiş
  useEffect(() => {
    if (game?.phase !== "reveal") {
      setRevealStep("put");
      return;
    }
    setRevealStep("put");
    playSfx("tap");
    const id = window.setTimeout(() => {
      setRevealStep("card");
      const ev = game.last_event;
      playSfx(ev?.kind === "hit" ? "confetti" : "timeUp");
    }, 1100);
    return () => window.clearTimeout(id);
  }, [game?.phase, game?.updated_at, game?.last_event]);

  const me = profile.userId;
  const isHost = room.host_id === me;
  const myTurn = game?.phase === "turn" && game.turn_profile_id === me;
  const myBank = game?.banks[me] ?? 0;

  const nameOf = useCallback(
    (id: string) =>
      players.find((p) => p.profile_id === id)?.profiles?.display_name ??
      t("common.player"),
    [players, t],
  );

  const range = useMemo(() => {
    if (!hand) return null;
    return rangeOf(hand.c1, hand.c2);
  }, [hand]);

  const playable = range != null && canStake(range.lo, range.hi);
  const options = useMemo(() => {
    if (!game || !playable) return [];
    return stakeOptions(game.pot, myBank);
  }, [game, myBank, playable]);

  const ranked = useMemo(() => {
    if (!game) return [];
    return [...game.seats].sort(
      (a, b) => (game.banks[b] ?? 0) - (game.banks[a] ?? 0),
    );
  }, [game]);

  const winners = useMemo(() => {
    if (!game || game.phase !== "match_end") return [];
    return leaders(game.banks, game.seats);
  }, [game]);

  const tableSeats = useMemo(() => {
    if (!game) return [] as string[];
    const seats = game.seats;
    const myIdx = seats.indexOf(me);
    if (myIdx < 0) return seats;
    return [...seats.slice(myIdx), ...seats.slice(0, myIdx)];
  }, [game, me]);

  const statusLine = useMemo(() => {
    if (!game) return "";
    const ev = game.last_event;

    if (game.phase === "reveal" && ev && (ev.kind === "hit" || ev.kind === "miss")) {
      const who = ev.by === me ? t("interval.youShort") : nameOf(ev.by);
      if (revealStep === "put") {
        return t("interval.statusPutWait", { name: who, n: ev.stake });
      }
      if (ev.kind === "hit") {
        return t("interval.statusHit", { name: who, n: ev.payout });
      }
      return t("interval.statusMiss", { name: who, n: ev.stake });
    }
    if (game.phase === "hand_end") {
      return t("interval.statusHandEnd", { n: game.hand_index, pot: game.pot });
    }
    if (game.phase === "match_end") {
      if (winners.length > 1) return t("interval.tie");
      if (winners[0] === me) return t("interval.youWon");
      return t("interval.theyWon", {
        name: nameOf(winners[0] ?? game.winner_id ?? ""),
      });
    }
    if (game.phase === "turn") {
      if (
        game.intent_amount != null &&
        game.turn_profile_id &&
        (ev?.kind === "intent" || game.intent_amount > 0)
      ) {
        const who =
          game.turn_profile_id === me
            ? t("interval.youShort")
            : nameOf(game.turn_profile_id);
        if (myTurn) {
          return t("interval.statusYourIntent", { n: game.intent_amount });
        }
        return t("interval.statusIntent", {
          name: who,
          n: game.intent_amount,
        });
      }
      if (myTurn) return t("interval.statusYourTurn");
      return t("interval.statusWaiting", {
        name: nameOf(game.turn_profile_id ?? ""),
      });
    }
    return "";
  }, [game, me, myTurn, nameOf, revealStep, t, winners]);

  function onPass() {
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        setGame(await intervalPass(roomId));
        playSfx("tap");
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onIntend(amount: number) {
    unlockSfx();
    setStake(amount);
    startTransition(async () => {
      try {
        setError(null);
        setGame(await intervalIntend(roomId, amount));
        playSfx("tap");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onPlay() {
    if (stake == null) return;
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        const next = await intervalBet(roomId, stake);
        setGame(next);
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onContinue() {
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        setGame(await intervalContinue(roomId));
        playSfx("tap");
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onRematch() {
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        setGame(await intervalRematch(roomId));
        playSfx("tap");
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  if (!game) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-8">
        <p className="text-center text-text-muted">{t("room.loading")}</p>
        {error && <p className="text-center text-danger">{error}</p>}
      </div>
    );
  }

  const ev = game.last_event;
  const iWon =
    game.phase === "match_end" &&
    (game.winner_id === me || (winners.length > 1 && winners.includes(me)));
  const revealReady =
    game.phase === "reveal" &&
    ev &&
    (ev.kind === "hit" || ev.kind === "miss");
  const showRevealCard = revealReady && revealStep === "card";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-3 pb-[calc(0.75rem+var(--safe-bottom))]">
      {iWon && <ConfettiBurst />}

      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-ghost text-base text-text-muted"
          onClick={() => router.push(href("/"))}
        >
          {t("common.home")}
        </button>
        <p className="text-base font-semibold text-text">Interval</p>
        <p className="text-base font-bold text-text tabular-nums">
          {t("interval.hand", { n: game.hand_index, max: game.hand_total })}
        </p>
      </header>

      <div
        className={clsx(
          "rounded-2xl px-4 py-3 text-center transition",
          game.phase === "reveal" &&
            revealStep === "card" &&
            ev?.kind === "hit" &&
            "bg-accent/20",
          game.phase === "reveal" &&
            revealStep === "card" &&
            ev?.kind === "miss" &&
            "bg-danger/15",
          game.phase === "reveal" && revealStep === "put" && "bg-accent/10",
          game.phase === "turn" &&
            game.intent_amount != null &&
            "bg-accent/12",
          game.phase === "turn" &&
            game.intent_amount == null &&
            myTurn &&
            "bg-accent/15",
          game.phase === "turn" &&
            game.intent_amount == null &&
            !myTurn &&
            "bg-bg-elevated",
          (game.phase === "hand_end" || game.phase === "match_end") &&
            "bg-bg-elevated",
        )}
      >
        <p
          className={clsx(
            "text-[17px] font-bold leading-snug",
            game.phase === "reveal" &&
              revealStep === "card" &&
              ev?.kind === "hit" &&
              "text-accent",
            game.phase === "reveal" &&
              revealStep === "card" &&
              ev?.kind === "miss" &&
              "text-danger",
            (myTurn ||
              game.intent_amount != null ||
              (game.phase === "reveal" && revealStep === "put")) &&
              !(
                game.phase === "reveal" &&
                revealStep === "card" &&
                ev?.kind === "miss"
              ) &&
              "text-accent",
            !(
              myTurn ||
              game.intent_amount != null ||
              game.phase === "reveal"
            ) && "text-text",
          )}
        >
          {statusLine}
        </p>
      </div>

      {game.phase !== "match_end" && (
        <section
          className="relative mx-auto w-full max-w-[22rem] overflow-visible"
          style={{ aspectRatio: "1 / 1.05" }}
          aria-label={t("interval.table")}
        >
          <div
            className="absolute inset-[8%] rounded-[50%] border border-[#2a5a4a]/50 shadow-[inset_0_0_40px_rgba(0,0,0,0.35)]"
            style={{
              background:
                "radial-gradient(ellipse at center, #1a3d32 0%, #122820 55%, #0c1a16 100%)",
            }}
          />

          {tableSeats.map((id, i) => {
            const turn =
              game.phase === "turn" && game.turn_profile_id === id;
            const p = players.find((x) => x.profile_id === id);
            const mine = id === me;
            const intending =
              turn && game.intent_amount != null && game.phase === "turn";
            return (
              <div
                key={id}
                className="absolute z-10 flex w-[5.5rem] flex-col items-center gap-0.5"
                style={seatStyle(i, tableSeats.length)}
              >
                <div
                  className={clsx(
                    "relative rounded-2xl border bg-bg-card/95 px-2 py-2 backdrop-blur-sm transition",
                    turn && "interval-seat-turn border-accent",
                    !turn && mine && "border-accent/40",
                    !turn && !mine && "border-border/70",
                  )}
                >
                  <AvatarImage
                    avatar={p?.profiles?.avatar_key ?? "panda"}
                    size="md"
                  />
                  {intending && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#041018]">
                      {game.intent_amount}
                    </span>
                  )}
                </div>
                <p
                  className={clsx(
                    "max-w-[5.5rem] truncate text-center text-[12px] font-semibold leading-tight",
                    turn ? "text-accent" : "text-text",
                  )}
                >
                  {mine ? t("interval.youShort") : nameOf(id)}
                </p>
                <p className="font-mono text-[16px] font-bold tabular-nums text-text">
                  {game.banks[id] ?? 0}
                </p>
              </div>
            );
          })}

          <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <div
              key={`pot-${fxTick}`}
              className={clsx(
                "relative flex h-[5.75rem] w-[5.75rem] flex-col items-center justify-center rounded-full border-2 border-accent/40 bg-[#0a1612]/95",
                potFx?.kind === "hit" &&
                  revealStep === "card" &&
                  "interval-pot-out",
                potFx?.kind === "in" &&
                  revealStep === "card" &&
                  "interval-pot-in",
                revealReady &&
                  revealStep === "put" &&
                  "interval-pot-in",
              )}
            >
              {showRevealCard && revealReady ? (
                <div className="interval-draw-pop">
                  <TileView
                    tile={ev.drawn}
                    className="!h-14 !w-12 !rounded-xl !text-[22px]"
                  />
                </div>
              ) : (
                <>
                  <p className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
                    {t("interval.pot")}
                  </p>
                  <p className="font-mono text-[28px] font-bold tabular-nums leading-none text-accent">
                    {game.pot}
                  </p>
                  {revealReady && revealStep === "put" && (
                    <span className="interval-float-down pointer-events-none absolute left-1/2 top-0 z-10 text-[15px] font-bold tabular-nums text-[#e8b84a]">
                      +{ev.stake}
                    </span>
                  )}
                </>
              )}
              {potFx && revealStep === "card" && (
                <span
                  key={potFx.key}
                  className={clsx(
                    "pointer-events-none absolute left-1/2 top-0 z-10 text-[15px] font-bold tabular-nums",
                    potFx.kind === "hit"
                      ? "interval-float-up text-[#3ecf8e]"
                      : "interval-float-down text-[#e85d5d]",
                  )}
                >
                  {potFx.kind === "hit"
                    ? `−${potFx.amount}`
                    : `+${potFx.amount}`}
                </span>
              )}
            </div>
            {showRevealCard && revealReady && (
              <p className="mt-1 whitespace-nowrap text-[12px] font-semibold text-text-muted">
                {t("interval.range", { lo: ev.lo, hi: ev.hi })}
              </p>
            )}
          </div>
        </section>
      )}

      {game.phase !== "match_end" && game.seen_tiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-center text-[11px] font-semibold tracking-wide text-text-dim uppercase">
            {t("interval.seen")}
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            {game.seen_tiles.map((tile, i) => (
              <TileView key={`${tile.color}-${tile.value}-${i}`} tile={tile} mini />
            ))}
          </div>
        </div>
      )}

      {game.phase !== "match_end" && (
        <section className="mt-1 space-y-3">
          {hand && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center justify-center gap-3">
                <TileView tile={hand.c1} />
                <TileView tile={hand.c2} />
              </div>
              <p className="text-center text-[15px] font-semibold text-text">
                {playable && range
                  ? t("interval.range", { lo: range.lo, hi: range.hi })
                  : t("interval.noRange")}
              </p>
            </div>
          )}

          {game.phase === "turn" && myTurn && (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={pending}
                onClick={onPass}
                className="btn w-full border border-border bg-bg-elevated py-3.5 text-[18px] font-bold text-text"
              >
                {t("interval.pass")}
              </button>
              {playable && options.length > 0 && (
                <>
                  <p className="text-center text-[13px] text-text-dim">
                    {t("interval.putHint")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {options.map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={pending}
                        onClick={() => onIntend(n)}
                        className={clsx(
                          "min-h-11 min-w-[3.25rem] rounded-xl px-3 py-2.5 text-[17px] font-bold transition",
                          stake === n
                            ? "bg-accent text-[#041018]"
                            : "border border-border bg-bg-elevated text-text-muted",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={pending || stake == null}
                    onClick={onPlay}
                    className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018] disabled:opacity-40"
                  >
                    {t("interval.draw")}
                  </button>
                </>
              )}
            </div>
          )}

          {game.phase === "reveal" && (
            <button
              type="button"
              disabled={pending || revealStep !== "card"}
              onClick={onContinue}
              className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018] disabled:opacity-40"
            >
              {revealStep === "card"
                ? t("interval.continue")
                : t("interval.drawing")}
            </button>
          )}

          {game.phase === "hand_end" && (
            <button
              type="button"
              disabled={pending}
              onClick={onContinue}
              className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018]"
            >
              {t("interval.nextHand")}
            </button>
          )}
        </section>
      )}

      {game.phase === "match_end" && (
        <section className="space-y-4 text-center">
          {ev?.kind === "burn" && ev.pot > 0 && (
            <p className="text-[16px] text-text-muted">
              {t("interval.burned", { n: ev.pot })}
            </p>
          )}
          <ol className="space-y-2 text-left">
            {ranked.map((id, i) => (
              <li
                key={id}
                className={clsx(
                  "flex items-center justify-between rounded-xl border px-3 py-2.5",
                  winners.includes(id)
                    ? "border-accent/50 bg-accent/10"
                    : "border-border/60 bg-bg-card",
                )}
              >
                <span className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <span className="text-text-dim tabular-nums">{i + 1}.</span>
                  <AvatarImage
                    avatar={
                      players.find((p) => p.profile_id === id)?.profiles
                        ?.avatar_key ?? "panda"
                    }
                    size="md"
                  />
                  {nameOf(id)}
                </span>
                <span className="font-mono text-[18px] font-bold tabular-nums text-text">
                  {game.banks[id] ?? 0}
                </span>
              </li>
            ))}
          </ol>
          {isHost ? (
            <button
              type="button"
              disabled={pending}
              onClick={onRematch}
              className="btn w-full bg-accent text-[18px] font-bold text-[#041018]"
            >
              {t("interval.rematch")}
            </button>
          ) : (
            <p className="text-[15px] text-text-muted">
              {t("interval.waitRematch")}
            </p>
          )}
        </section>
      )}

      {error && <p className="text-center text-[15px] text-danger">{error}</p>}
    </div>
  );
}
