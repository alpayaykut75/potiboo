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
            ? "h-[3.6rem] w-[3rem] rounded-xl text-[26px]"
            : "h-12 w-10 rounded-lg text-[20px]",
        className,
      )}
      style={{ backgroundColor: colorHex(tile.color) }}
    >
      {tile.value}
    </div>
  );
}

/** Saat yönü sabit: 0=alt (seats[0]), 1–3 sağ, 4=üst, 5–7 sol — herkes aynı masa */
const TABLE_SLOTS = 8;

function slotStyle(slot: number): CSSProperties {
  const base: CSSProperties = { position: "absolute", zIndex: 10 };
  switch (slot) {
    case 0:
      return { ...base, left: "50%", bottom: "2%", transform: "translateX(-50%)" };
    case 1:
      return { ...base, right: "1.5%", bottom: "16%" };
    case 2:
      return { ...base, right: "1.5%", top: "50%", transform: "translateY(-50%)" };
    case 3:
      return { ...base, right: "1.5%", top: "14%" };
    case 4:
      return { ...base, left: "50%", top: "2%", transform: "translateX(-50%)" };
    case 5:
      return { ...base, left: "1.5%", top: "14%" };
    case 6:
      return { ...base, left: "1.5%", top: "50%", transform: "translateY(-50%)" };
    case 7:
      return { ...base, left: "1.5%", bottom: "16%" };
    default:
      return base;
  }
}

/** seats sırası sabit; herkes aynı slotları görür */
function assignTableSlots(seatIds: string[]): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: TABLE_SLOTS }, () => null);
  const n = seatIds.length;
  if (n === 0) return slots;
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let s = Math.floor((i * TABLE_SLOTS) / n) % TABLE_SLOTS;
    while (used.has(s)) s = (s + 1) % TABLE_SLOTS;
    used.add(s);
    slots[s] = seatIds[i]!;
  }
  return slots;
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

  const potDisplay = useAnimatedNumber(potTarget, 900);

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
      }, 280);
      const clear = window.setTimeout(() => setDeltaLabel(null), 2200);
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
        }, 200);
        const clear = window.setTimeout(() => setDeltaLabel(null), 1800);
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
      }, 450);
      const clear = window.setTimeout(() => setDeltaLabel(null), 2400);
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
    }, 140);
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

  /** Herkese aynı masa: seats[0] altta */
  const tableSlots = useMemo(() => {
    if (!game) return Array.from({ length: TABLE_SLOTS }, () => null);
    return assignTableSlots(game.seats);
  }, [game]);

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

  /** Adım adım popup metni (kurucu Devam ile akar) */
  const announceText = useMemo(() => {
    if (!game || preHand) return "";
    const ev = game.last_event;

    if (game.phase === "reveal" && ev) {
      if (ev.kind === "ante") {
        return t("interval.statusAnte", { n: ev.per, pot: ev.to_pot });
      }
      if (ev.kind === "pass") {
        const who = ev.by === me ? t("interval.youShort") : nameOf(ev.by);
        return t("interval.statusPass", { name: who });
      }
      if (ev.kind === "hit" || ev.kind === "miss") {
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
    return "";
  }, [game, me, nameOf, preHand, spinLeft, spinning, t, winners]);

  const intentLine = useMemo(() => {
    if (!game || game.phase !== "turn" || game.intent_amount == null) return "";
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
  }, [game, me, myTurn, nameOf, t]);

  const showAnnounce =
    announceText !== "" &&
    (game?.phase === "reveal" ||
      game?.phase === "hand_end" ||
      game?.phase === "match_end");

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
  const announceTone =
    spinning || ev?.kind === "hit" || ev?.kind === "ante"
      ? "accent"
      : ev?.kind === "miss"
        ? "danger"
        : "neutral";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-2 pb-[calc(0.5rem+var(--safe-bottom))]">
      {iWon && <ConfettiBurst />}

      <header className="relative z-30 flex shrink-0 items-center justify-between gap-2 pb-1">
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

      {intentLine !== "" && (
        <div className="mb-1.5 shrink-0 rounded-xl bg-accent/12 px-3 py-2 text-center">
          <p className="text-[15px] font-bold leading-snug text-accent">
            {intentLine}
          </p>
        </div>
      )}

      {game.phase !== "match_end" && (
        <section
          className="relative mx-auto min-h-0 w-full max-w-lg flex-1"
          aria-label={t("interval.table")}
        >
          {/* Turkuaz masa — hafif kenar boşluğu */}
          <div
            className="absolute inset-2.5 rounded-[1.75rem] border border-[#2a7a7e]/50 shadow-[inset_0_0_48px_rgba(0,0,0,0.35)]"
            style={{
              background:
                "radial-gradient(ellipse at center, #1a5f63 0%, #13484c 48%, #0c2f33 100%)",
            }}
          />

          {tableSlots.map((id, slot) => {
            if (id == null) {
              return (
                <div
                  key={`empty-${slot}`}
                  className="flex w-[5.75rem] flex-col items-center opacity-35"
                  style={slotStyle(slot)}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/25 bg-black/15" />
                </div>
              );
            }
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
                className="flex w-[6rem] flex-col items-center"
                style={slotStyle(slot)}
              >
                <div
                  className={clsx(
                    "relative rounded-2xl border-[3px] bg-bg-card/95 p-1.5 backdrop-blur-sm",
                    turn && "interval-seat-turn border-accent",
                    !turn && mine && "border-accent/40",
                    !turn && !mine && "border-border/70",
                  )}
                >
                  <AvatarImage
                    avatar={p?.profiles?.avatar_key ?? "panda"}
                    size="lg"
                    rounded="2xl"
                  />
                  {intending && (
                    <span className="absolute -right-1.5 -top-1.5 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[13px] font-bold text-[#041018]">
                      {game.intent_amount}
                    </span>
                  )}
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-lg bg-[#0a1612]/95 px-2 py-0.5 font-mono text-[16px] font-bold tabular-nums text-accent">
                    {game.banks[id] ?? 0}
                  </span>
                </div>
                <p className="mt-2.5 max-w-[6rem] truncate text-center text-[15px] font-bold leading-tight text-text">
                  {mine ? t("interval.youShort") : nameOf(id)}
                </p>
              </div>
            );
          })}

          <div className="absolute left-1/2 top-1/2 z-20 flex w-[min(11.5rem,48%)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <div className="relative flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full border-2 border-accent/50 bg-[#0a1612]/92">
              <p className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
                {t("interval.pot")}
              </p>
              <p className="font-mono text-[28px] font-bold tabular-nums leading-none text-accent">
                {potDisplay}
              </p>
              {deltaLabel && (
                <span className="interval-float-down pointer-events-none absolute left-1/2 top-0 text-[15px] font-bold text-[#e8b84a]">
                  {deltaLabel}
                </span>
              )}
            </div>

            {(showPublicHand || spinning || drawn) && (
              <div className="w-full rounded-xl border border-white/15 bg-[#061418]/55 px-2 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-[6px]">
                <div className="flex flex-col items-center gap-1.5">
                  {showPublicHand && (
                    <div className="flex items-center justify-center gap-2">
                      <TileView tile={game.public_c1!} large />
                      <TileView tile={game.public_c2!} large />
                    </div>
                  )}
                  {spinning ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="interval-card-spin">
                        <TileView tile={randomSpinTile(spinFace)} large />
                      </div>
                      <p className="font-mono text-[11px] font-bold text-accent tabular-nums">
                        {spinLeft}
                      </p>
                    </div>
                  ) : drawn ? (
                    <div className="interval-draw-pop">
                      <TileView tile={drawn} large />
                    </div>
                  ) : showPublicHand ? (
                    <div className="flex h-[3.6rem] w-[3rem] items-center justify-center rounded-xl border border-dashed border-white/25 text-[20px] font-bold text-white/35">
                      ?
                    </div>
                  ) : null}
                </div>
                {showPublicHand &&
                  publicRange &&
                  !canStake(publicRange.lo, publicRange.hi) &&
                  !showAnnounce && (
                    <p className="mt-1.5 text-center text-[11px] font-semibold text-white/60">
                      {t("interval.noRange")}
                    </p>
                  )}
              </div>
            )}
          </div>

          {showAnnounce && game.phase !== "match_end" && (
            <div className="absolute inset-2.5 z-30 flex items-center justify-center rounded-[1.75rem] bg-black/40 px-4 backdrop-blur-[3px]">
              <div
                className={clsx(
                  "w-full max-w-[17rem] rounded-2xl border px-4 py-5 text-center shadow-lg",
                  announceTone === "accent" &&
                    "border-accent/40 bg-[#0a1612]/80",
                  announceTone === "danger" &&
                    "border-danger/40 bg-[#160a0a]/80",
                  announceTone === "neutral" &&
                    "border-white/20 bg-[#0a1612]/80",
                )}
              >
                <p
                  className={clsx(
                    "text-[18px] font-bold leading-snug",
                    announceTone === "accent" && "text-accent",
                    announceTone === "danger" && "text-danger",
                    announceTone === "neutral" && "text-white",
                  )}
                >
                  {announceText}
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {game.phase === "match_end" && (
        <section className="mt-2 flex-1 space-y-3 overflow-y-auto text-center">
          {ev?.kind === "burn" && ev.pot > 0 && (
            <p className="text-[15px] text-text-muted">
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
        </section>
      )}

      <div className="mt-auto shrink-0 border-t border-border/50 bg-bg/95 pt-2 backdrop-blur-sm">
        {preHand &&
          (isHost ? (
            <button
              type="button"
              disabled={pending}
              onClick={onContinue}
              className="btn w-full bg-accent py-3 text-[17px] font-bold text-[#041018]"
            >
              {t("interval.startFirstHand")}
            </button>
          ) : (
            <p className="py-2 text-center text-[14px] text-text-muted">
              {t("interval.waitHostAction")}
            </p>
          ))}

        {game.phase === "turn" && myTurn && !preHand && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={onPass}
              className="min-h-11 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-[15px] font-bold text-text"
            >
              {t("interval.pass")}
            </button>
            {playable &&
              options.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => onIntend(n)}
                  className={clsx(
                    "min-h-11 min-w-[2.75rem] rounded-xl px-2.5 py-2 text-[16px] font-bold transition",
                    stake === n
                      ? "bg-accent text-[#041018]"
                      : "border border-border bg-bg-elevated text-text-muted",
                  )}
                >
                  {n}
                </button>
              ))}
            {playable && (
              <button
                type="button"
                disabled={pending || stake == null}
                onClick={onPlay}
                className="min-h-11 rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#041018] disabled:opacity-40"
              >
                {t("interval.draw")}
              </button>
            )}
          </div>
        )}

        {game.phase === "reveal" &&
          (spinning ? (
            <p className="py-2 text-center text-[14px] font-semibold text-accent">
              {t("interval.spinWait", { sec: spinLeft })}
            </p>
          ) : isHost ? (
            <button
              type="button"
              disabled={pending}
              onClick={onContinue}
              className="btn w-full bg-accent py-3 text-[17px] font-bold text-[#041018]"
            >
              {t("interval.continue")}
            </button>
          ) : (
            <p className="py-2 text-center text-[14px] text-text-muted">
              {t("interval.waitHostAction")}
            </p>
          ))}

        {game.phase === "hand_end" &&
          (isHost ? (
            <button
              type="button"
              disabled={pending}
              onClick={onContinue}
              className="btn w-full bg-accent py-3 text-[17px] font-bold text-[#041018]"
            >
              {t("interval.nextHand")}
            </button>
          ) : (
            <p className="py-2 text-center text-[14px] text-text-muted">
              {t("interval.waitHostAction")}
            </p>
          ))}

        {game.phase === "match_end" &&
          (isHost ? (
            <button
              type="button"
              disabled={pending}
              onClick={onRematch}
              className="btn w-full bg-accent py-3 text-[17px] font-bold text-[#041018]"
            >
              {t("interval.rematch")}
            </button>
          ) : (
            <p className="py-2 text-center text-[14px] text-text-muted">
              {t("interval.waitRematch")}
            </p>
          ))}

        {error && (
          <p className="pt-1 text-center text-[14px] text-danger">{error}</p>
        )}
      </div>
    </div>
  );
}
