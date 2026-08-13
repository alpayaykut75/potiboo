"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  INTERVAL_COLORS,
  canStake,
  colorHex,
  isIntervalPreHand,
  leaders,
  rangeOf,
  stakeOptions,
  type IntervalGameRow,
  type IntervalHandRow,
  type IntervalTile,
} from "@/lib/games/interval";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

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
            ? "h-20 w-[4.25rem] rounded-2xl text-[32px]"
            : "h-14 w-12 rounded-xl text-[22px]",
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
  // Ortadaki kart paneline yer: koltuklar biraz dışarı
  const rx = 44;
  const ry = 40;
  return {
    left: `${50 + Math.cos(angle) * rx}%`,
    top: `${50 + Math.sin(angle) * ry}%`,
    transform: "translate(-50%, -50%)",
  };
}

function randomSpinTile(seed: number): IntervalTile {
  const color = INTERVAL_COLORS[seed % INTERVAL_COLORS.length]!.id;
  const value = (seed % 10) + 1;
  return { value, color };
}

function useAnimatedNumber(target: number, durationMs = 700) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t);
      const next = Math.round(from + (target - from) * eased);
      setDisplay(next);
      fromRef.current = next;
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return display;
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
  const [now, setNow] = useState(() => Date.now());
  const [spinFace, setSpinFace] = useState(0);
  const [potTarget, setPotTarget] = useState(0);
  const [deltaLabel, setDeltaLabel] = useState<string | null>(null);

  const potDisplay = useAnimatedNumber(potTarget, 650);

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
    if (game?.phase === "turn") setStake(game.intent_amount);
  }, [game?.phase, game?.intent_amount, game?.turn_profile_id]);

  // Pot hedefi + ante / reveal animasyonları
  useEffect(() => {
    if (!game) return;
    const ev = game.last_event;

    if (ev?.kind === "ante") {
      setPotTarget(ev.from_pot);
      setDeltaLabel(`+${ev.to_pot - ev.from_pot}`);
      playSfx("tap");
      const id = window.setTimeout(() => {
        setPotTarget(ev.to_pot);
      }, 120);
      const clear = window.setTimeout(() => setDeltaLabel(null), 1200);
      return () => {
        window.clearTimeout(id);
        window.clearTimeout(clear);
      };
    }

    if (
      game.phase === "reveal" &&
      ev &&
      (ev.kind === "hit" || ev.kind === "miss")
    ) {
      const revealAt = game.reveal_at ? Date.parse(game.reveal_at) : Date.now();
      const spinning = Date.now() < revealAt;
      if (spinning) {
        setPotTarget(ev.pot_before);
        const id = window.setTimeout(() => {
          setPotTarget(ev.pot_before + ev.stake);
          setDeltaLabel(`+${ev.stake}`);
        }, 80);
        const clear = window.setTimeout(() => setDeltaLabel(null), 900);
        return () => {
          window.clearTimeout(id);
          window.clearTimeout(clear);
        };
      }
      // Açıldı: final pot (+ hit ise ortadan düşüş)
      setPotTarget(ev.pot_before + ev.stake);
      const id = window.setTimeout(() => {
        setPotTarget(ev.pot_after);
        if (ev.kind === "hit") {
          setDeltaLabel(`−${ev.payout}`);
          playSfx("confetti");
        } else {
          setDeltaLabel(null);
          playSfx("timeUp");
        }
      }, 200);
      const clear = window.setTimeout(() => setDeltaLabel(null), 1400);
      return () => {
        window.clearTimeout(id);
        window.clearTimeout(clear);
      };
    }

    setPotTarget(game.pot);
    return;
  }, [game?.phase, game?.pot, game?.last_event, game?.reveal_at, game?.updated_at]);

  // Spin tick
  useEffect(() => {
    if (game?.phase !== "reveal" || !game.reveal_at) return;
    const end = Date.parse(game.reveal_at);
    if (!Number.isFinite(end)) return;
    const tick = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() < end) setSpinFace((n) => n + 1);
    }, 90);
    return () => window.clearInterval(tick);
  }, [game?.phase, game?.reveal_at, game?.updated_at]);

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

  const publicRange = useMemo(() => {
    if (!game?.public_c1 || !game.public_c2) return null;
    return rangeOf(game.public_c1, game.public_c2);
  }, [game?.public_c1, game?.public_c2]);

  const myRange = useMemo(() => {
    if (!hand) return null;
    return rangeOf(hand.c1, hand.c2);
  }, [hand]);

  const playable = myRange != null && canStake(myRange.lo, myRange.hi);
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

  const revealAtMs = game?.reveal_at ? Date.parse(game.reveal_at) : 0;
  const spinning =
    game?.phase === "reveal" &&
    Number.isFinite(revealAtMs) &&
    now < revealAtMs;
  const spinLeft = spinning
    ? Math.max(0, Math.ceil((revealAtMs - now) / 1000))
    : 0;
  const revealed =
    game?.phase === "reveal" &&
    (!game.reveal_at || now >= revealAtMs);

  const preHand = game ? isIntervalPreHand(game) : false;

  /** Sıra metni yok — sadece olay / sonuç / niyet */
  const statusLine = useMemo(() => {
    if (!game || preHand) return "";
    const ev = game.last_event;

    if (game.phase === "reveal" && ev && (ev.kind === "hit" || ev.kind === "miss")) {
      const who = ev.by === me ? t("interval.youShort") : nameOf(ev.by);
      if (spinning) {
        return t("interval.statusSpinning", {
          name: who,
          n: ev.stake,
          sec: spinLeft,
        });
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
    if (ev?.kind === "ante" && game.phase === "turn") {
      return t("interval.statusAnte", { n: ev.per, pot: ev.to_pot });
    }
    if (game.phase === "turn" && game.intent_amount != null) {
      const turnName =
        game.turn_profile_id === me
          ? t("interval.youShort")
          : nameOf(game.turn_profile_id ?? "");
      if (myTurn) {
        return t("interval.statusYourIntent", { n: game.intent_amount });
      }
      return t("interval.statusIntent", {
        name: turnName,
        n: game.intent_amount,
      });
    }
    return "";
  }, [game, me, myTurn, nameOf, preHand, spinLeft, spinning, t, winners]);

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
        setGame(await intervalBet(roomId, stake));
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
  const showPublicHand =
    (game.phase === "turn" || game.phase === "reveal") &&
    game.public_c1 &&
    game.public_c2;
  const drawn =
    revealed && ev && (ev.kind === "hit" || ev.kind === "miss") ? ev.drawn : null;

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
          {preHand
            ? t("interval.handReady")
            : t("interval.hand", { n: game.hand_index, max: game.hand_total })}
        </p>
      </header>

      {statusLine !== "" && (
        <div
          className={clsx(
            "rounded-2xl px-4 py-3 text-center",
            spinning && "bg-accent/12",
            revealed && ev?.kind === "hit" && "bg-accent/20",
            revealed && ev?.kind === "miss" && "bg-danger/15",
            !spinning && !revealed && "bg-bg-elevated",
          )}
        >
          <p
            className={clsx(
              "text-[17px] font-bold leading-snug",
              (spinning || game.intent_amount != null) && "text-accent",
              revealed && ev?.kind === "hit" && "text-accent",
              revealed && ev?.kind === "miss" && "text-danger",
              !spinning &&
                game.intent_amount == null &&
                !revealed &&
                "text-text",
            )}
          >
            {statusLine}
          </p>
        </div>
      )}

      {game.phase !== "match_end" && (
        <section
          className="relative mx-auto w-full max-w-[22rem]"
          style={{ aspectRatio: "1 / 1.08" }}
          aria-label={t("interval.table")}
        >
          <div
            className="absolute inset-[7%] rounded-[50%] border border-[#2a5a4a]/50 shadow-[inset_0_0_40px_rgba(0,0,0,0.35)]"
            style={{
              background:
                "radial-gradient(ellipse at center, #1a3d32 0%, #122820 55%, #0c1a16 100%)",
            }}
          />

          {tableSeats.map((id, i) => {
            const turn =
              !preHand &&
              game.phase === "turn" &&
              game.turn_profile_id === id;
            const p = players.find((x) => x.profile_id === id);
            const mine = id === me;
            const intending = turn && game.intent_amount != null;
            return (
              <div
                key={id}
                className="absolute z-10 flex w-[5.5rem] flex-col items-center gap-0.5"
                style={seatStyle(i, tableSeats.length)}
              >
                <div
                  className={clsx(
                    "relative rounded-2xl border-2 bg-bg-card/95 px-2 py-2 backdrop-blur-sm",
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
                <p className="max-w-[5.5rem] truncate text-center text-[12px] font-semibold text-text">
                  {mine ? t("interval.youShort") : nameOf(id)}
                </p>
                <p className="font-mono text-[16px] font-bold tabular-nums text-text">
                  {game.banks[id] ?? 0}
                </p>
              </div>
            );
          })}

          {/* Orta: pot üstte; kartlar yarı saydam panelde */}
          <div className="absolute left-1/2 top-1/2 z-20 flex w-[13.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <div className="relative flex h-[3.75rem] w-[3.75rem] flex-col items-center justify-center rounded-full border-2 border-accent/45 bg-[#0a1612]/92">
              <p className="text-[9px] font-bold tracking-wider text-accent/80 uppercase">
                {t("interval.pot")}
              </p>
              <p className="font-mono text-[22px] font-bold tabular-nums leading-none text-accent">
                {potDisplay}
              </p>
              {deltaLabel && (
                <span className="interval-float-down pointer-events-none absolute left-1/2 top-0 text-[13px] font-bold text-[#e8b84a]">
                  {deltaLabel}
                </span>
              )}
            </div>

            {(showPublicHand || spinning || drawn) && (
              <div className="w-full rounded-2xl border border-white/15 bg-[#06140f]/55 px-3 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-[6px]">
                <div className="flex items-end justify-center gap-2">
                  {showPublicHand && (
                    <>
                      <TileView tile={game.public_c1!} />
                      <TileView tile={game.public_c2!} />
                    </>
                  )}
                  <div className="mx-0.5 h-10 w-px self-center bg-white/20" />
                  {spinning ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="interval-card-spin">
                        <TileView tile={randomSpinTile(spinFace)} />
                      </div>
                      <p className="font-mono text-[11px] font-bold text-accent tabular-nums">
                        {spinLeft}
                      </p>
                    </div>
                  ) : drawn ? (
                    <div className="interval-draw-pop">
                      <TileView tile={drawn} />
                    </div>
                  ) : (
                    <div className="flex h-14 w-12 items-center justify-center rounded-xl border border-dashed border-white/25 text-[18px] font-bold text-white/35">
                      ?
                    </div>
                  )}
                </div>
                {showPublicHand && (
                  <p className="mt-1.5 text-center text-[12px] font-semibold text-white/75">
                    {publicRange && canStake(publicRange.lo, publicRange.hi)
                      ? t("interval.range", {
                          lo: publicRange.lo,
                          hi: publicRange.hi,
                        })
                      : t("interval.noRange")}
                    {drawn &&
                      ev &&
                      (ev.kind === "hit" || ev.kind === "miss") &&
                      ` → ${drawn.value}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {game.phase !== "match_end" && !preHand && game.seen_tiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-center text-[11px] font-semibold tracking-wide text-text-dim uppercase">
            {t("interval.seen")}
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            {game.seen_tiles.map((tile, i) => (
              <TileView
                key={`${tile.color}-${tile.value}-${i}`}
                tile={tile}
                mini
              />
            ))}
          </div>
        </div>
      )}

      {preHand && (
        <section className="space-y-2">
          <button
            type="button"
            disabled={pending}
            onClick={onContinue}
            className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018]"
          >
            {t("interval.startFirstHand")}
          </button>
        </section>
      )}

      {game.phase === "turn" && myTurn && !preHand && (
        <section className="space-y-2.5">
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
        </section>
      )}

      {game.phase === "reveal" && (
        <button
          type="button"
          disabled={pending || spinning}
          onClick={onContinue}
          className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018] disabled:opacity-40"
        >
          {spinning
            ? t("interval.spinWait", { sec: spinLeft })
            : t("interval.continue")}
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
