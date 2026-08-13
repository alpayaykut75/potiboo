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
  fetchOnlukGame,
  onlukAckRule,
  onlukAddRule,
  onlukPlayToken,
  onlukRematch,
  onlukTimeout,
} from "@/lib/games/onluk-api";
import {
  ONLUK_NUMBER_CHIPS,
  ONLUK_WIN_SCORE,
  wordChipsFromSequence,
  type OnlukGameRow,
  type OnlukLastEvent,
  type OnlukRule,
} from "@/lib/games/onluk";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

type RuleKind = OnlukRule["type"];

export function OnlukGameClient({
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
  const [game, setGame] = useState<OnlukGameRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [ruleKind, setRuleKind] = useState<RuleKind | null>(null);
  const [swapPick, setSwapPick] = useState<number[]>([]);
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [skipIndex, setSkipIndex] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, nextGame] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchOnlukGame(roomId),
    ]);
    if (nextRoom) setRoom(nextRoom);
    setPlayers(nextPlayers);
    setGame(nextGame);
  }, [roomId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : t("room.loadFailed")),
    );
  }, [refresh, t]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`onluk:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "onluk_games",
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
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!game || game.phase === "match_end") return;
    // reveal'da süre sadece yedek; asıl geçiş Anlaşıldı ile
    const deadline = Date.parse(game.deadline_at);
    if (!Number.isFinite(deadline) || deadline > Date.now()) return;
    const handle = window.setTimeout(() => {
      startTransition(async () => {
        try {
          setGame(await onlukTimeout(roomId));
        } catch {
          /* başka client zaten işlemiş olabilir */
        }
      });
    }, Math.max(0, deadline - Date.now() + 50));
    return () => window.clearTimeout(handle);
  }, [game, roomId]);

  useEffect(() => {
    setRuleKind(null);
    setSwapPick([]);
    setRenameIndex(null);
    setRenameText("");
    setSkipIndex(null);
  }, [game?.phase, game?.rules.length, game?.updated_at]);

  const me = profile.userId;
  const isHost = room.host_id === me;
  const myTurn = game?.turn_profile_id === me;
  const nameOf = useCallback(
    (id: string) =>
      players.find((p) => p.profile_id === id)?.profiles?.display_name ??
      t("common.player"),
    [players, t],
  );

  const msLeft = useMemo(() => {
    if (!game || game.phase === "match_end" || game.phase === "reveal") {
      return 0;
    }
    return Math.max(0, Date.parse(game.deadline_at) - now);
  }, [game, now]);

  const secondsLeft = Math.ceil(msLeft / 1000);

  const wordChips = useMemo(
    () => (game ? wordChipsFromSequence(game.sequence) : []),
    [game],
  );

  const iAcked =
    game != null &&
    ((me === game.player_a && game.ack_a) ||
      (me === game.player_b && game.ack_b));

  const ruleHeadline = useMemo(() => {
    const ev = game?.last_event;
    if (!ev || ev.kind !== "rule") return null;
    return formatRuleHeadline(ev, t);
  }, [game?.last_event, t]);

  function playToken(token: string) {
    if (!game || !myTurn || game.phase !== "counting" || pending) return;
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        const next = await onlukPlayToken(roomId, token);
        setGame(next);
        if (
          next.last_event?.kind === "wrong" ||
          next.last_event?.kind === "timeout"
        ) {
          playSfx("timeUp");
        } else {
          playSfx("tap");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function submitRule(rule: OnlukRule) {
    if (!game || !myTurn || game.phase !== "rule" || pending) return;
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        const next = await onlukAddRule(roomId, rule);
        setGame(next);
        playSfx("tap");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onRematch() {
    startTransition(async () => {
      try {
        setError(null);
        setGame(await onlukRematch(roomId));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  function onAck() {
    if (!game || game.phase !== "reveal" || iAcked || pending) return;
    unlockSfx();
    startTransition(async () => {
      try {
        setError(null);
        setGame(await onlukAckRule(roomId));
        playSfx("tap");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common.errorGeneric"));
      }
    });
  }

  if (!game) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-text-muted">{t("common.preparing")}</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const scoreLine = `${nameOf(game.player_a)} ${game.score_a}–${game.score_b} ${nameOf(game.player_b)}`;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-4 pb-[calc(1rem+var(--safe-bottom))]">
      {game.phase === "match_end" && game.winner_id === me && (
        <ConfettiBurst />
      )}

      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-ghost text-base text-text-muted"
          onClick={() => router.push(href("/"))}
        >
          {t("common.home")}
        </button>
        <p className="text-base font-semibold text-text">Onluk</p>
        <p className="text-base font-bold text-text tabular-nums">
          {game.score_a}:{game.score_b}
        </p>
      </header>

      <p className="text-center text-[15px] text-text-muted">{scoreLine}</p>
      <p className="text-center text-sm text-text-dim">
        {t("onluk.firstTo", { n: ONLUK_WIN_SCORE })}
      </p>

      {(game.phase === "counting" || game.phase === "rule") && (
        <div className="flex flex-col items-center gap-1">
          <p
            className={clsx(
              "text-[18px] font-bold",
              myTurn ? "text-accent" : "text-text-muted",
            )}
          >
            {myTurn
              ? t("onluk.yourTurn")
              : t("onluk.theirTurn", { name: nameOf(game.turn_profile_id) })}
          </p>
          <p
            className={clsx(
              "font-mono text-[28px] font-bold tabular-nums",
              secondsLeft <= 1 ? "text-danger" : "text-text",
            )}
          >
            {secondsLeft}
          </p>
        </div>
      )}

      {game.phase === "counting" && (
        <section className="space-y-3">
          <p className="text-center text-[15px] text-text-muted">
            {t("onluk.step", {
              n: game.cursor + 1,
              max: game.sequence.length,
            })}
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {ONLUK_NUMBER_CHIPS.map((token) => (
              <button
                key={token}
                type="button"
                disabled={!myTurn || pending}
                onClick={() => playToken(token)}
                className={clsx(
                  "min-h-11 rounded-xl border px-1 py-2 text-[17px] font-bold transition sm:min-h-12 sm:text-[18px]",
                  myTurn
                    ? "border-border bg-bg-elevated text-text active:bg-accent active:text-[#041018]"
                    : "border-border/50 bg-bg-card text-text-dim opacity-60",
                )}
              >
                {token}
              </button>
            ))}
          </div>
          {wordChips.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-center text-[13px] text-text-dim">
                {t("onluk.wordChips")}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {wordChips.map((token) => (
                  <button
                    key={token}
                    type="button"
                    disabled={!myTurn || pending}
                    onClick={() => playToken(token)}
                    className={clsx(
                      "min-h-11 rounded-xl border px-3 py-2 text-[16px] font-bold transition",
                      myTurn
                        ? "border-accent/40 bg-accent/15 text-text active:bg-accent active:text-[#041018]"
                        : "border-border/50 bg-bg-card text-text-dim opacity-60",
                    )}
                  >
                    {token}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {game.phase === "reveal" && (
        <section className="card flex flex-col items-center gap-5 p-6 text-center">
          <p className="text-[16px] font-semibold tracking-wide text-text-muted uppercase">
            {t("onluk.newRule")}
          </p>
          <p className="text-[36px] font-extrabold leading-tight text-text sm:text-[42px]">
            {ruleHeadline ?? t("onluk.ruleReverse")}
          </p>
          {iAcked ? (
            <p className="text-[16px] text-text-muted">{t("onluk.waitAck")}</p>
          ) : (
            <button
              type="button"
              className="btn w-full bg-accent py-3.5 text-[18px] font-bold text-[#041018]"
              disabled={pending}
              onClick={onAck}
            >
              {t("onluk.gotIt")}
            </button>
          )}
          <p className="text-[14px] text-text-dim">
            {t("onluk.ackProgress", {
              n: Number(game.ack_a) + Number(game.ack_b),
            })}
          </p>
        </section>
      )}

      {game.phase === "rule" && (
        <section className="card space-y-3 p-4">
          <p className="text-center text-[16px] font-semibold text-text">
            {myTurn ? t("onluk.addRule") : t("onluk.waitRule")}
          </p>

          {myTurn && !ruleKind && (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["swap", t("onluk.ruleSwap")],
                  ["rename", t("onluk.ruleRename")],
                  ["skip", t("onluk.ruleSkip")],
                  ["reverse", t("onluk.ruleReverse")],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  className="btn btn-secondary min-h-12 text-[15px] font-semibold"
                  onClick={() => {
                    if (kind === "reverse") {
                      submitRule({ type: "reverse" });
                      return;
                    }
                    setRuleKind(kind);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {myTurn && ruleKind === "swap" && (
            <div className="space-y-2">
              <p className="text-[15px] text-text-muted">{t("onluk.pickTwo")}</p>
              <div className="flex flex-wrap gap-2">
                {game.sequence.map((token, i) => {
                  const selected = swapPick.includes(i);
                  return (
                    <button
                      key={`${token}-${i}`}
                      type="button"
                      className={clsx(
                        "min-h-11 rounded-xl px-3 py-2 text-[17px] font-bold",
                        selected
                          ? "bg-accent text-[#041018]"
                          : "border border-border bg-bg-elevated text-text",
                      )}
                      onClick={() => {
                        let next = swapPick.includes(i)
                          ? swapPick.filter((x) => x !== i)
                          : swapPick.length >= 2
                            ? [swapPick[1]!, i]
                            : [...swapPick, i];
                        setSwapPick(next);
                        if (next.length === 2) {
                          submitRule({
                            type: "swap",
                            i: next[0]!,
                            j: next[1]!,
                          });
                        }
                      }}
                    >
                      {token}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn-ghost text-sm text-text-muted"
                onClick={() => {
                  setRuleKind(null);
                  setSwapPick([]);
                }}
              >
                {t("common.back")}
              </button>
            </div>
          )}

          {myTurn && ruleKind === "rename" && (
            <div className="space-y-3">
              <p className="text-[15px] text-text-muted">{t("onluk.pickSource")}</p>
              <div className="flex flex-wrap gap-2">
                {game.sequence.map((token, i) => (
                  <button
                    key={`${token}-${i}`}
                    type="button"
                    className={clsx(
                      "min-h-11 rounded-xl px-3 py-2 text-[17px] font-bold",
                      renameIndex === i
                        ? "bg-accent text-[#041018]"
                        : "border border-border bg-bg-elevated text-text",
                    )}
                    onClick={() => setRenameIndex(i)}
                  >
                    {token}
                  </button>
                ))}
              </div>
              {renameIndex != null && (
                <>
                  <p className="text-[15px] text-text-muted">{t("onluk.pickTarget")}</p>
                  <div className="flex flex-wrap gap-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                      (n) => (
                        <button
                          key={n}
                          type="button"
                          className="min-h-11 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-[17px] font-bold text-text"
                          onClick={() =>
                            submitRule({
                              type: "rename",
                              index: renameIndex,
                              token: n,
                            })
                          }
                        >
                          {n}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      maxLength={12}
                      placeholder={t("onluk.wordPlaceholder")}
                      className="min-h-11 flex-1 rounded-xl border border-border bg-bg-elevated px-3 text-base text-text"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary min-h-11 px-4"
                      disabled={!renameText.trim()}
                      onClick={() =>
                        submitRule({
                          type: "rename",
                          index: renameIndex,
                          token: renameText,
                        })
                      }
                    >
                      {t("onluk.confirm")}
                    </button>
                  </div>
                </>
              )}
              <button
                type="button"
                className="btn-ghost text-sm text-text-muted"
                onClick={() => {
                  setRuleKind(null);
                  setRenameIndex(null);
                  setRenameText("");
                }}
              >
                {t("common.back")}
              </button>
            </div>
          )}

          {myTurn && ruleKind === "skip" && (
            <div className="space-y-2">
              <p className="text-[15px] text-text-muted">{t("onluk.pickSkip")}</p>
              <div className="flex flex-wrap gap-2">
                {game.sequence.map((token, i) => (
                  <button
                    key={`${token}-${i}`}
                    type="button"
                    className={clsx(
                      "min-h-11 rounded-xl px-3 py-2 text-[17px] font-bold",
                      skipIndex === i
                        ? "bg-accent text-[#041018]"
                        : "border border-border bg-bg-elevated text-text",
                    )}
                    onClick={() => {
                      setSkipIndex(i);
                      submitRule({ type: "skip", index: i });
                    }}
                  >
                    {token}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-ghost text-sm text-text-muted"
                onClick={() => {
                  setRuleKind(null);
                  setSkipIndex(null);
                }}
              >
                {t("common.back")}
              </button>
            </div>
          )}
        </section>
      )}

      {game.phase === "match_end" && (
        <section className="card space-y-4 p-5 text-center">
          <p className="text-[22px] font-bold text-text">
            {game.winner_id === me
              ? t("onluk.youWon")
              : t("onluk.theyWon", {
                  name: nameOf(game.winner_id ?? game.player_a),
                })}
          </p>
          <p className="text-[18px] text-text-muted">{scoreLine}</p>
          {isHost ? (
            <button
              type="button"
              className="btn w-full bg-accent text-[18px] font-bold text-[#041018]"
              disabled={pending}
              onClick={onRematch}
            >
              {t("onluk.rematch")}
            </button>
          ) : (
            <p className="text-[15px] text-text-muted">{t("onluk.waitRematch")}</p>
          )}
        </section>
      )}

      <ul className="mt-auto space-y-2">
        {players.map((p) => {
          const host = p.profile_id === room.host_id;
          const turn = game.turn_profile_id === p.profile_id;
          return (
            <li
              key={p.id}
              className={clsx(
                "card flex items-center gap-3 px-3 py-2.5",
                turn && game.phase !== "match_end" && "ring-1 ring-accent/50",
              )}
            >
              <AvatarImage
                avatar={p.profiles?.avatar_key ?? "panda"}
                size="md"
              />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-[16px] font-semibold text-text">
                  {p.profiles?.display_name ?? t("common.player")}
                  {p.profile_id === me ? ` ${t("common.you")}` : ""}
                </p>
                <p className="text-[13px] text-text-dim">
                  {host ? t("common.host") : t("common.player")}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function formatRuleHeadline(
  ev: Extract<OnlukLastEvent, { kind: "rule" }>,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string {
  switch (ev.rule.type) {
    case "swap":
      return t("onluk.headlineSwap", {
        a: ev.a ?? "?",
        b: ev.b ?? "?",
      });
    case "rename":
      return t("onluk.headlineRename", {
        a: ev.a ?? "?",
        b: ev.b ?? ev.rule.token,
      });
    case "skip":
      return t("onluk.headlineSkip", { a: ev.a ?? "?" });
    case "reverse":
      return t("onluk.headlineReverse");
  }
}
