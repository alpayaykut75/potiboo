"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
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
  type IntervalTile,
} from "@/lib/games/interval";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

function TileView({ tile, large }: { tile: IntervalTile; large?: boolean }) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center rounded-2xl font-bold text-[#041018] shadow-sm",
        large ? "h-24 w-20 text-[36px]" : "h-16 w-14 text-[26px]",
      )}
      style={{ backgroundColor: colorHex(tile.color) }}
    >
      {tile.value}
    </div>
  );
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
    setStake(null);
  }, [game?.phase, game?.turn_profile_id, game?.hand_index, game?.updated_at]);

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

  function onPlay() {
    if (stake == null) return;
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        const next = await intervalBet(roomId, stake);
        setGame(next);
        playSfx(next.last_event?.kind === "hit" ? "confetti" : "timeUp");
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-4 pb-[calc(1rem+var(--safe-bottom))]">
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

      <section className="flex flex-col items-center gap-1 rounded-2xl border border-border/60 bg-bg-elevated/60 px-4 py-3">
        <p className="text-[13px] font-semibold tracking-wide text-text-dim uppercase">
          {t("interval.pot")}
        </p>
        <p className="font-mono text-[40px] font-bold tabular-nums text-accent">
          {game.pot}
        </p>
        <p className="text-[15px] text-text-muted">
          {t("interval.yourBank", { n: myBank })}
        </p>
      </section>

      {game.phase === "turn" && (
        <div className="flex flex-col items-center gap-1">
          <p
            className={clsx(
              "text-[18px] font-bold",
              myTurn ? "text-accent" : "text-text-muted",
            )}
          >
            {myTurn
              ? t("interval.yourTurn")
              : t("interval.theirTurn", {
                  name: nameOf(game.turn_profile_id ?? ""),
                })}
          </p>
        </div>
      )}

      {hand && game.phase !== "match_end" && (
        <section className="space-y-3">
          <div className="flex items-center justify-center gap-3">
            <TileView tile={hand.c1} />
            <TileView tile={hand.c2} />
          </div>
          <p className="text-center text-[16px] font-semibold text-text">
            {playable && range
              ? t("interval.range", { lo: range.lo, hi: range.hi })
              : t("interval.noRange")}
          </p>
        </section>
      )}

      {game.phase === "turn" && myTurn && (
        <section className="space-y-3">
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
              <p className="text-center text-[14px] text-text-dim">
                {t("interval.putHint")}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={pending}
                    onClick={() => setStake(n)}
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

      {game.phase === "turn" && !myTurn && (
        <p className="text-center text-[15px] text-text-dim">
          {t("interval.waitTurn")}
        </p>
      )}

      {game.phase === "reveal" && ev && (ev.kind === "hit" || ev.kind === "miss") && (
        <section className="space-y-4 text-center">
          <p className="text-[15px] text-text-muted">
            {ev.by === me
              ? t("interval.youDrew")
              : t("interval.theyDrew", { name: nameOf(ev.by) })}
          </p>
          <div className="flex justify-center">
            <TileView tile={ev.drawn} large />
          </div>
          <p className="text-[14px] text-text-dim">
            {t("interval.range", { lo: ev.lo, hi: ev.hi })}
          </p>
          <p
            className={clsx(
              "text-[22px] font-bold",
              ev.kind === "hit" ? "text-accent" : "text-danger",
            )}
          >
            {ev.kind === "hit"
              ? t("interval.hit", { n: ev.payout })
              : t("interval.miss", { n: ev.stake })}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onContinue}
            className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018]"
          >
            {t("interval.continue")}
          </button>
        </section>
      )}

      {game.phase === "hand_end" && (
        <section className="space-y-4 text-center">
          <p className="text-[22px] font-bold text-text">
            {t("interval.handDone", { n: game.hand_index })}
          </p>
          <p className="text-[16px] text-text-muted">
            {t("interval.potCarries", { n: game.pot })}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onContinue}
            className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018]"
          >
            {t("interval.nextHand")}
          </button>
        </section>
      )}

      {game.phase === "match_end" && (
        <section className="space-y-4 text-center">
          <p className="text-[28px] font-bold text-text">
            {winners.length > 1
              ? t("interval.tie")
              : winners[0] === me
                ? t("interval.youWon")
                : t("interval.theyWon", {
                    name: nameOf(winners[0] ?? game.winner_id ?? ""),
                  })}
          </p>
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
                  {nameOf(id)}
                </span>
                <span className="font-mono text-[17px] font-bold tabular-nums text-text">
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

      <section className="mt-auto space-y-2">
        <p className="text-center text-[13px] font-semibold tracking-wide text-text-dim uppercase">
          {t("interval.banks")}
        </p>
        <ul className="space-y-1.5">
          {game.seats.map((id) => {
            const turn = game.turn_profile_id === id;
            const p = players.find((x) => x.profile_id === id);
            return (
              <li
                key={id}
                className={clsx(
                  "flex items-center justify-between rounded-xl border px-3 py-2",
                  turn && game.phase === "turn" && "ring-1 ring-accent/50",
                  id === me ? "border-border bg-bg-elevated" : "border-border/50",
                )}
              >
                <span className="flex items-center gap-2">
                  <AvatarImage
                    avatar={p?.profiles?.avatar_key ?? "panda"}
                    size="sm"
                  />
                  <span className="text-[15px] font-semibold text-text">
                    {nameOf(id)}
                    {id === me ? ` · ${t("common.you")}` : ""}
                  </span>
                </span>
                <span className="font-mono text-[16px] font-bold tabular-nums text-text">
                  {game.banks[id] ?? 0}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {error && <p className="text-center text-[15px] text-danger">{error}</p>}
    </div>
  );
}
