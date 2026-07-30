"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GAME } from "@/lib/constants";
import { pickSpinLetter } from "@/lib/game/letter-pool";
import { useLocale } from "@/components/i18n/locale-provider";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import { ConfettiBurst } from "@/components/confetti";
import {
  advanceReveal,
  advanceToNextRound,
  beginWriting,
  ensureRound,
  ensureRoundPlayerRows,
  fetchRoundAnswers,
  fetchRoundPlayers,
  fetchUsedLetters,
  markFinished,
  saveAnswers,
  applyScores,
  answersContentFingerprint,
  stopLetter,
  tryFinalizeWriting,
} from "@/lib/rounds/api";
import {
  activeObjection,
  castVote,
  fetchObjectionsForRound,
  fetchVotes,
  raiseObjection,
  resolveObjection,
  shouldResolveObjection,
} from "@/lib/rounds/objections";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import type { Room, RoomPlayerWithProfile, RoomSettings } from "@/lib/rooms/types";
import type {
  AnswerRow,
  ObjectionRow,
  ObjectionVoteRow,
  Round,
  RoundPlayerRow,
} from "@/lib/rounds/types";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";
import {
  pushRecentLetter,
  readRecentLetters,
} from "@/lib/game/recent-letters";

export function GameClient({
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
  const [round, setRound] = useState<Round | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [objections, setObjections] = useState<ObjectionRow[]>([]);
  const [votes, setVotes] = useState<ObjectionVoteRow[]>([]);
  const [spinLetter, setSpinLetter] = useState<string>("A");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voteSecLeft, setVoteSecLeft] = useState<number | null>(null);
  const [categorySecLeft, setCategorySecLeft] = useState<number | null>(null);
  const [finishBanner, setFinishBanner] = useState<string | null>(null);
  const [usedLetters, setUsedLetters] = useState<string[]>(
    initialRoom.used_letters ?? [],
  );
  const finalizing = useRef(false);
  const resolving = useRef(false);
  const prevFinishedRef = useRef<Set<string>>(new Set());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const roundIdRef = useRef<string | null>(null);
  const lastCountdownSfx = useRef<number | null>(null);
  const urgencyArmed = useRef(true);
  const lastUrgentTick = useRef<number | null>(null);
  const letterLockKey = useRef<string | null>(null);
  const timeUpPlayed = useRef(false);
  const confettiPlayed = useRef(false);
  const scoredFingerprint = useRef<string | null>(null);
  const scoringInFlight = useRef(false);

  const settings = room.settings as RoomSettings;

  // Mobil: ses için ilk dokunuşta AudioContext aç
  useEffect(() => {
    const unlock = () => {
      void unlockSfx();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const isStopper = round?.stopper_id === profile.userId;
  const isHost = room.host_id === profile.userId;
  const stopperName =
    players.find((p) => p.profile_id === round?.stopper_id)?.profiles
      ?.display_name ?? "Oyuncu";

  const revealIndex = round?.reveal_index ?? 0;
  const categoryCount = settings.categories.length;
  const onSummary = revealIndex >= categoryCount;
  const currentCategory = onSummary
    ? null
    : settings.categories[revealIndex] ?? null;

  const active = activeObjection(objections);
  const queueVoting = objections.filter((o) => o.status === "voting");
  const queuePos =
    active != null
      ? queueVoting.findIndex((o) => o.id === active.id) + 1
      : 0;

  const myObjectionsUsed =
    roundPlayers.find((r) => r.profile_id === profile.userId)
      ?.objections_used ?? 0;

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, letters] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchUsedLetters(roomId).catch(() => [] as string[]),
    ]);
    if (!nextRoom) return;
    setRoom(nextRoom);
    setPlayers(nextPlayers);
    setUsedLetters(
      letters.length > 0 ? letters : (nextRoom.used_letters ?? []),
    );

    if (nextRoom.status === "finished") return;

    const r = await ensureRound(nextRoom, nextPlayers);

    // Tur değiştiyse yazma state'ini sıfırla (instant-end bug)
    if (roundIdRef.current !== r.id) {
      roundIdRef.current = r.id;
      setRoundPlayers([]);
      setAnswers([]);
      setObjections([]);
      setVotes([]);
      setFinished(false);
      finalizing.current = false;
      const empty: Record<string, string> = {};
      for (const c of (nextRoom.settings as RoomSettings).categories) {
        empty[c] = "";
      }
      setDrafts(empty);
    }

    setRound({
      ...r,
      reveal_index: r.reveal_index ?? 0,
      reveal_started_at: r.reveal_started_at ?? null,
    });

    if (r.phase === "waiting" || r.phase === "spinning" || r.phase === "countdown") {
      setRoundPlayers([]);
      setFinished(false);
    }

    if (r.phase === "writing" || r.phase === "scoring" || r.phase === "done") {
      await ensureRoundPlayerRows(
        r.id,
        nextPlayers.map((p) => p.profile_id),
      );
      const rps = await fetchRoundPlayers(r.id);
      setRoundPlayers(rps);
      const me = rps.find((x) => x.profile_id === profile.userId);
      setFinished(Boolean(me?.finished_at));
    }

    if (r.phase === "scoring" || r.phase === "done") {
      const ans = await fetchRoundAnswers(r.id);
      setAnswers(ans);
      const objs = await fetchObjectionsForRound(r.id);
      setObjections(objs);
      const act = activeObjection(objs);
      if (act) {
        setVotes(await fetchVotes(act.id));
      } else {
        setVotes([]);
      }
    }
  }, [roomId, profile.userId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "Yüklenemedi"),
    );
  }, [refresh]);

  // Free / uzun oturum: realtime koparsa periyodik yenile + sekmeye dönüş
  useEffect(() => {
    if (room.status === "finished") return;
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [refresh, room.status]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`game:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "objections" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_players" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers" },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  // Harf çarkı — oda + son oyunlar (yumuşak kaçınma)
  useEffect(() => {
    if (!round || (round.phase !== "waiting" && round.phase !== "spinning")) {
      return;
    }
    const recent = readRecentLetters();
    let n = 0;
    const id = window.setInterval(() => {
      setSpinLetter(pickSpinLetter(usedLetters, recent));
      n += 1;
      if (n % 2 === 0) playSfx("spinTick");
    }, 80);
    return () => window.clearInterval(id);
  }, [round?.phase, round?.id, usedLetters]);

  // Geri sayım
  useEffect(() => {
    if (!round || round.phase !== "countdown" || !round.started_at) {
      setCountdown(null);
      return;
    }
    const start = new Date(round.started_at).getTime();
    const tick = () => {
      const left = Math.ceil(3 - (Date.now() - start) / 1000);
      if (left <= 0) {
        setCountdown(0);
        void beginWriting(round.id).then(() => refresh());
      } else setCountdown(left);
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [round?.id, round?.phase, round?.started_at, refresh]);

  // Yazma süresi
  useEffect(() => {
    if (!round || round.phase !== "writing" || !round.started_at) {
      setSecondsLeft(null);
      return;
    }
    const start = new Date(round.started_at).getTime();
    const durationMs = settings.duration * 1000;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((start + durationMs - Date.now()) / 1000),
      );
      setSecondsLeft(left);
      if (left <= 0 && !finalizing.current) {
        finalizing.current = true;
        void tryFinalizeWriting({
          round,
          room,
          players,
          myAnswers: draftsRef.current,
        })
          .then(() => refresh())
          .finally(() => {
            finalizing.current = false;
          });
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [
    round?.id,
    round?.phase,
    round?.started_at,
    settings.duration,
    room,
    players,
    refresh,
  ]);

  // SFX: harf kilitlendi (herkes duyar)
  useEffect(() => {
    if (!round || round.phase !== "countdown" || !round.letter) return;
    const key = `${round.id}:${round.letter}`;
    if (letterLockKey.current === key) return;
    letterLockKey.current = key;
    lastCountdownSfx.current = null;
    playSfx("letterLock");
  }, [round?.id, round?.phase, round?.letter]);

  // SFX: 3-2-1 / Başla!
  useEffect(() => {
    if (countdown == null) return;
    if (lastCountdownSfx.current === countdown) return;
    lastCountdownSfx.current = countdown;
    if (countdown > 0) playSfx("countdownTick");
    else playSfx("countdownGo");
  }, [countdown]);

  // SFX: son 10 sn
  useEffect(() => {
    if (secondsLeft == null || round?.phase !== "writing") {
      urgencyArmed.current = true;
      lastUrgentTick.current = null;
      timeUpPlayed.current = false;
      return;
    }
    if (secondsLeft === 10 && urgencyArmed.current) {
      urgencyArmed.current = false;
      playSfx("urgency");
    }
    if (secondsLeft <= 10 && secondsLeft >= 1) {
      if (lastUrgentTick.current !== secondsLeft) {
        lastUrgentTick.current = secondsLeft;
        if (secondsLeft < 10) playSfx("urgentTick");
      }
    }
    if (secondsLeft === 0 && !timeUpPlayed.current) {
      timeUpPlayed.current = true;
      playSfx("timeUp");
    }
  }, [secondsLeft, round?.phase]);

  // SFX: podyum / konfeti
  useEffect(() => {
    if (room.status !== "finished") {
      confettiPlayed.current = false;
      return;
    }
    if (confettiPlayed.current) return;
    confettiPlayed.current = true;
    void unlockSfx().then(() => playSfx("confetti"));
  }, [room.status]);

  // Scoring: herkes tüm kategorileri flush eder; kurucu bekleyip puanlar
  // (geç gelen cevaplarda yeniden hesaplar)
  useEffect(() => {
    if (!round || round.phase !== "scoring") {
      scoredFingerprint.current = null;
      return;
    }

    let cancelled = false;
    const categories = settings.categories;
    const expected = players.length * categories.length;

    (async () => {
      try {
        await saveAnswers(round.id, draftsRef.current, categories);
      } catch (e) {
        console.warn("scoring flush:", e);
      }

      if (room.host_id !== profile.userId || cancelled) return;

      // Diğer oyuncuların tüm kategori satırlarının gelmesini bekle
      for (let i = 0; i < 30; i++) {
        if (cancelled) return;
        const ans = await fetchRoundAnswers(round.id);
        if (ans.length >= expected) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (cancelled || scoringInFlight.current) return;

      scoringInFlight.current = true;
      try {
        const ans = await fetchRoundAnswers(round.id);
        const fp = answersContentFingerprint(ans);
        await applyScores(round.id, room, players);
        scoredFingerprint.current = fp;
        if (!cancelled) await refresh();
      } catch (e) {
        console.warn("scoring apply:", e);
      } finally {
        scoringInFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [round?.id, round?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geç gelen / güncellenen cevaplar → kurucu yeniden puanlar
  useEffect(() => {
    if (!round || round.phase !== "scoring") return;
    if (room.host_id !== profile.userId) return;
    if (answers.length === 0) return;

    const fp = answersContentFingerprint(answers);
    if (fp === scoredFingerprint.current) return;

    const expected = players.length * settings.categories.length;
    // İlk flush henüz tamamlanmadıysa bekle
    if (
      answers.length < expected &&
      scoredFingerprint.current == null
    ) {
      return;
    }

    const t = window.setTimeout(() => {
      if (scoringInFlight.current) return;
      if (fp === scoredFingerprint.current) return;
      scoringInFlight.current = true;
      void applyScores(round.id, room, players)
        .then(async () => {
          scoredFingerprint.current = fp;
          await refresh();
        })
        .catch((e) => console.warn("scoring rescore:", e))
        .finally(() => {
          scoringInFlight.current = false;
        });
    }, 500);

    return () => window.clearTimeout(t);
  }, [
    answers,
    round?.id,
    round?.phase,
    room,
    players,
    profile.userId,
    settings.categories,
    refresh,
  ]);

  // Herkes bitince
  useEffect(() => {
    if (!round || round.phase !== "writing") return;
    // Bu tura ait satırlar yoksa (henüz yüklenmedi) tetikleme
    if (roundPlayers.length === 0) return;

    const allDone = players.every((p) =>
      roundPlayers.some(
        (rp) => rp.profile_id === p.profile_id && rp.finished_at != null,
      ),
    );
    if (allDone && !finalizing.current) {
      finalizing.current = true;
      void tryFinalizeWriting({
        round,
        room,
        players,
        myAnswers: draftsRef.current,
      })
        .then(() => refresh())
        .finally(() => {
          finalizing.current = false;
        });
    }
  }, [round, roundPlayers, players, room, refresh]);

  // İtiraz oylama süresi / otomatik çözüm
  useEffect(() => {
    if (!active || !round) {
      setVoteSecLeft(null);
      return;
    }
    const answerOwnerId =
      answers.find((a) => a.id === active.answer_id)?.profile_id ?? "";
    const tick = () => {
      const elapsed =
        (Date.now() - new Date(active.created_at).getTime()) / 1000;
      const left = Math.max(0, Math.ceil(GAME.objectionVoteSec - elapsed));
      setVoteSecLeft(left);

      if (
        shouldResolveObjection(active, votes, players, answerOwnerId) &&
        !resolving.current
      ) {
        resolving.current = true;
        void resolveObjection({
          objection: active,
          room,
          players,
          roundId: round.id,
        })
          .then(() => refresh())
          .finally(() => {
            resolving.current = false;
          });
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [active, votes, players, room, round, refresh, answers]);

  // Kategori min süre — kurucu Devam kilidi
  useEffect(() => {
    if (
      !round ||
      round.phase !== "scoring" ||
      onSummary ||
      !round.reveal_started_at
    ) {
      setCategorySecLeft(null);
      return;
    }
    const start = new Date(round.reveal_started_at).getTime();
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil(GAME.categoryRevealSec - (Date.now() - start) / 1000),
      );
      setCategorySecLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [
    round?.id,
    round?.phase,
    round?.reveal_index,
    round?.reveal_started_at,
    onSummary,
  ]);

  // “X bitirdi!” bildirimi
  useEffect(() => {
    if (!round || round.phase !== "writing") {
      prevFinishedRef.current = new Set();
      return;
    }
    const current = new Set(
      roundPlayers.filter((r) => r.finished_at).map((r) => r.profile_id),
    );
    for (const id of current) {
      if (prevFinishedRef.current.has(id)) continue;
      if (id === profile.userId) continue;
      const name =
        players.find((p) => p.profile_id === id)?.profiles?.display_name ??
        "Bir oyuncu";
      setFinishBanner(`${name} bitirdi!`);
      window.setTimeout(() => setFinishBanner(null), 2800);
    }
    prevFinishedRef.current = current;
  }, [roundPlayers, round?.phase, round?.id, players, profile.userId]);

  async function onDur() {
    setError(null);
    setBusy(true);
    void unlockSfx().then(() => playSfx("tap"));
    try {
      await stopLetter(round!.id, spinLetter, roomId);
      pushRecentLetter(spinLetter);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "DUR başarısız");
    } finally {
      setBusy(false);
    }
  }

  async function onBitirdim() {
    if (!round || finished) return;
    setBusy(true);
    setError(null);
    try {
      await markFinished(round.id, drafts, settings.categories);
      setFinished(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function onAdvanceReveal() {
    if (!round) return;
    setBusy(true);
    setError(null);
    try {
      await advanceReveal(round, room);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Devam edilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function onNextRound() {
    setBusy(true);
    setError(null);
    try {
      await advanceToNextRound(room, players);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Devam edilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function onObject(answer: AnswerRow) {
    if (!round || !currentCategory) return;
    setBusy(true);
    setError(null);
    try {
      await raiseObjection({
        answerId: answer.id,
        answerOwnerId: answer.profile_id,
        roundId: round.id,
        category: answer.category,
        currentRevealCategory: currentCategory,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İtiraz edilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function onVote(isValid: boolean) {
    if (!active) return;
    setBusy(true);
    try {
      await castVote(active.id, isValid);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Oy kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  const displayLetter =
    round?.phase === "waiting" || round?.phase === "spinning"
      ? spinLetter
      : (round?.letter ?? spinLetter);

  // ─── Final ──────────────────────────────────────────────
  if (room.status === "finished") {
    const ranked = [...players].sort(
      (a, b) => (b.total_score ?? 0) - (a.total_score ?? 0),
    );
    const top3 = ranked.slice(0, 3);
    const rest = ranked.slice(3);
    const heights = ["h-36", "h-28", "h-20"] as const;
    const medals = ["🥇", "🥈", "🥉"] as const;
    const delays = ["0.25s", "0.05s", "0.45s"] as const;

    return (
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-5 py-6 text-center">
        <ConfettiBurst />
        <h1 className="relative z-10 text-3xl font-extrabold text-text">
          Oyun bitti!
        </h1>
        <p className="relative z-10 text-text-muted">Podyum</p>

        {top3.length > 0 && (
          <div className="relative z-10 mt-8 grid grid-cols-3 items-end gap-2">
            {[1, 0, 2].map((slot) => {
              const p = top3[slot];
              if (!p) return <div key={slot} />;
              return (
                <div key={p.id} className="flex flex-col items-center">
                  <div
                    className="animate-medal"
                    style={{ animationDelay: delays[slot] }}
                  >
                    <AvatarImage
                      avatar={p.profiles?.avatar_key ?? "panda"}
                      size="xl"
                    />
                  </div>
                  <span
                    className="mt-1 max-w-full truncate text-sm font-bold"
                    style={{ animationDelay: delays[slot] }}
                  >
                    {p.profiles?.display_name ?? "Oyuncu"}
                  </span>
                  <span className="font-mono text-accent">
                    {p.total_score}
                  </span>
                  <div
                    className={`animate-rise mt-2 flex w-full origin-bottom ${heights[slot]} items-start justify-center rounded-t-2xl bg-gradient-to-t from-accent/80 to-accent pt-2 text-2xl`}
                    style={{ animationDelay: delays[slot] }}
                  >
                    {medals[slot]}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rest.length > 0 && (
          <ol className="relative z-10 mt-6 space-y-2 text-left">
            {rest.map((p, i) => (
              <li key={p.id} className="card flex items-center gap-3 px-3 py-2.5">
                <span className="w-6 text-sm font-bold text-text-dim">
                  {i + 4}
                </span>
                <AvatarImage
                  avatar={p.profiles?.avatar_key ?? "panda"}
                  size="sm"
                />
                <span className="flex-1 truncate font-semibold">
                  {p.profiles?.display_name ?? "Oyuncu"}
                </span>
                <span className="font-mono font-bold text-accent">
                  {p.total_score}
                </span>
              </li>
            ))}
          </ol>
        )}

        <button
          type="button"
          className="btn btn-primary relative z-10 mt-auto w-full"
          onClick={() => router.push(href("/"))}
        >
          Ana ekrana dön
        </button>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
        Tur hazırlanıyor…
      </div>
    );
  }

  // ─── DUR ────────────────────────────────────────────────
  if (round.phase === "waiting" || round.phase === "spinning") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-5 py-8 text-center">
        <p className="text-sm text-text-dim">
          Tur {round.round_number} / {settings.roundCount}
        </p>
        <div className="flex h-40 w-40 items-center justify-center rounded-full border-2 border-accent/40 bg-bg-card">
          <span className="font-mono text-8xl font-extrabold text-accent">
            {displayLetter}
          </span>
        </div>
        {isStopper ? (
          <>
            <p className="text-text-muted">Harfi sen seçiyorsun</p>
            <button
              type="button"
              className="btn btn-primary h-24 w-56 text-4xl font-extrabold tracking-wide"
              disabled={busy}
              onClick={onDur}
            >
              DUR
            </button>
          </>
        ) : (
          <p className="text-lg text-text-muted">
            <span className="font-semibold text-text">{stopperName}</span> harfi
            seçiyor…
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (round.phase === "countdown") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-sm text-text-muted">Harf</p>
        <p className="font-mono text-8xl font-extrabold text-accent">
          {round.letter}
        </p>
        <p className="text-5xl font-extrabold text-text">
          {countdown && countdown > 0 ? countdown : "Başla!"}
        </p>
      </div>
    );
  }

  // ─── Yazma (mobil büyük) ────────────────────────────────
  if (round.phase === "writing") {
    const catAccent: Record<string, string> = {
      İsim: "border-l-[#3d9dc4]",
      Şehir: "border-l-[#5bb8a8]",
      Hayvan: "border-l-[#e8b84a]",
      Bitki: "border-l-[#3ecf8e]",
      Eşya: "border-l-[#c47bb8]",
    };

    return (
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-3 pb-[calc(1rem+var(--safe-bottom))]">
        {finishBanner && (
          <div className="pointer-events-none absolute inset-x-4 top-2 z-20 rounded-2xl bg-accent px-4 py-3 text-center text-base font-extrabold text-[#041018] shadow-lg animate-pulse">
            {finishBanner}
          </div>
        )}

        <header className="flex items-center justify-between gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 font-mono text-3xl font-extrabold text-accent ring-2 ring-accent/30">
            {round.letter}
          </div>
          <div className="text-right">
            <p className="text-xs text-text-dim">Tur {round.round_number}</p>
            <p
              className={clsx(
                "font-mono text-3xl font-bold tabular-nums",
                secondsLeft != null && secondsLeft <= 10
                  ? "text-danger"
                  : "text-text",
              )}
            >
              {secondsLeft ?? settings.duration}
            </p>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {settings.categories.map((cat) => (
            <label key={cat} className="block text-left">
              <span className="mb-1.5 block text-sm font-bold tracking-wide text-text-muted">
                {cat}
              </span>
              <input
                value={drafts[cat] ?? ""}
                disabled={finished}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [cat]: e.target.value }))
                }
                className={clsx(
                  "w-full rounded-2xl border-2 border-white/10 bg-bg-card px-4 py-4 text-xl font-bold text-text outline-none transition",
                  "border-l-4 focus:border-accent focus:ring-2 focus:ring-accent/25",
                  catAccent[cat] ?? "border-l-accent",
                  finished && "opacity-60",
                )}
                placeholder={`${round.letter}…`}
                autoComplete="off"
                enterKeyHint="next"
                autoCapitalize="words"
              />
            </label>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary min-h-14 w-full text-xl"
          disabled={busy || finished}
          onClick={onBitirdim}
        >
          {finished ? "Bekleniyor…" : "Bitirdim"}
        </button>
        {error && <p className="text-center text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // ─── Tur özeti ──────────────────────────────────────────
  if (round.phase === "scoring" && onSummary) {
    const ranked = [...players].sort((a, b) => {
      const sa =
        roundPlayers.find((r) => r.profile_id === a.profile_id)?.round_score ??
        0;
      const sb =
        roundPlayers.find((r) => r.profile_id === b.profile_id)?.round_score ??
        0;
      return sb - sa;
    });

    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-6 text-center">
        <div>
          <p className="text-sm text-text-dim">Tur {round.round_number}</p>
          <h1 className="text-2xl font-extrabold text-text">Tur puanları</h1>
          <p className="text-text-muted">
            Harf{" "}
            <span className="font-mono font-bold text-accent">
              {round.letter}
            </span>
          </p>
        </div>
        <ol className="space-y-2 text-left">
          {ranked.map((p, i) => {
            const rp = roundPlayers.find((r) => r.profile_id === p.profile_id);
            return (
              <li key={p.id} className="card flex items-center gap-3 px-3 py-3">
                <span className="w-6 text-lg font-bold text-accent">
                  {i + 1}
                </span>
                <AvatarImage
                  avatar={p.profiles?.avatar_key ?? "panda"}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {p.profiles?.display_name}
                  </p>
                  {rp && rp.speed_bonus > 0 && (
                    <p className="text-xs text-text-dim">
                      +{rp.speed_bonus} hız
                    </p>
                  )}
                </div>
                <span className="font-mono text-lg font-bold text-accent">
                  {rp?.round_score ?? 0}
                </span>
              </li>
            );
          })}
        </ol>
        {isHost ? (
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy}
            onClick={onNextRound}
          >
            {room.current_round >= settings.roundCount
              ? "Finali Gör"
              : "Sonraki Tur"}
          </button>
        ) : (
          <p className="text-sm text-text-muted">
            Kurucu devam ettirene kadar bekle…
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // ─── Kategori açılışı ───────────────────────────────────
  const categoryAnswers = answers.filter((a) => a.category === currentCategory);
  const activeAnswer = active
    ? answers.find((a) => a.id === active.answer_id)
    : null;
  const activeOwnerName =
    players.find((p) => p.profile_id === activeAnswer?.profile_id)?.profiles
      ?.display_name ?? "Oyuncu";
  const myVote = votes.find((v) => v.profile_id === profile.userId);
  const isAnswerOwner = activeAnswer?.profile_id === profile.userId;
  const canVote =
    active &&
    active.raised_by !== profile.userId &&
    !isAnswerOwner &&
    !myVote;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-5 pb-[calc(1rem+var(--safe-bottom))]">
      <header className="text-center">
        <p className="text-xs text-text-dim">
          Tur {round.round_number} · Harf{" "}
          <span className="font-mono font-bold text-accent">{round.letter}</span>
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-text">
          {currentCategory}
        </h1>
        <p className="text-xs text-text-dim">
          Kategori {revealIndex + 1} / {categoryCount}
        </p>
      </header>

      {/* Aktif itiraz paneli */}
      {active && activeAnswer && (
        <div className="card space-y-3 border-accent/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-accent">İtiraz</p>
            {queueVoting.length > 1 && (
              <span className="text-xs text-text-dim">
                {queuePos}/{queueVoting.length}
              </span>
            )}
          </div>
          <div className="rounded-xl bg-bg-elevated px-3 py-3 text-center">
            <p className="text-sm text-text-muted">{activeOwnerName}</p>
            <p className="text-2xl font-extrabold text-text">
              “{activeAnswer.value?.trim() || "—"}”
            </p>
          </div>
          <p className="text-center text-base font-semibold text-text">
            Bu kelime doğru mu?
            {voteSecLeft != null && (
              <span className="ml-2 font-mono text-sm font-bold text-text-muted">
                {voteSecLeft}s
              </span>
            )}
          </p>
          {canVote ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1 text-lg"
                disabled={busy}
                onClick={() => onVote(true)}
              >
                Doğru
              </button>
              <button
                type="button"
                className="btn btn-secondary flex-1 text-lg"
                disabled={busy}
                onClick={() => onVote(false)}
              >
                Yanlış
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-text-dim">
              {active.raised_by === profile.userId
                ? "İtirazı sen açtın — otomatik Yanlış sayıldın."
                : isAnswerOwner
                  ? "Bu senin kelimen — oy kullanamazsın."
                  : myVote
                    ? myVote.is_valid
                      ? "Seçimin: Doğru"
                      : "Seçimin: Yanlış"
                    : "Oy bekleniyor…"}
            </p>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {players.map((p) => {
          const ans = categoryAnswers.find((a) => a.profile_id === p.profile_id);
          const isMine = p.profile_id === profile.userId;
          const canObject =
            !active &&
            !isMine &&
            ans?.id &&
            ans.value?.trim() &&
            !ans.is_invalidated &&
            myObjectionsUsed < GAME.objectionsPerRound &&
            !objections.some((o) => o.answer_id === ans.id);

          return (
            <li key={p.id} className="card flex items-center gap-3 px-3 py-3">
              <AvatarImage
                avatar={p.profiles?.avatar_key ?? "panda"}
                size="md"
              />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-text-muted">
                  {p.profiles?.display_name}
                </p>
                <p
                  className={clsx(
                    "truncate text-lg font-bold",
                    ans?.is_invalidated && "text-danger line-through",
                  )}
                >
                  {ans?.value?.trim() ? ans.value : "—"}
                </p>
              </div>
              <span className="font-mono text-base font-bold text-accent">
                {ans?.is_invalidated ? 0 : (ans?.score ?? 0)}
              </span>
              {canObject && (
                <button
                  type="button"
                  className="shrink-0 rounded-xl border border-danger/40 px-2 py-1 text-xs font-semibold text-danger"
                  disabled={busy}
                  onClick={() => ans && onObject(ans)}
                >
                  İtiraz
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-center text-xs text-text-dim">
        İtiraz hakkı: {myObjectionsUsed}/{GAME.objectionsPerRound}
      </p>

      {isHost ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={
            busy ||
            Boolean(active) ||
            (categorySecLeft != null && categorySecLeft > 0)
          }
          onClick={onAdvanceReveal}
        >
          {categorySecLeft != null && categorySecLeft > 0
            ? `Devam (${categorySecLeft}s)`
            : revealIndex + 1 >= categoryCount
              ? "Tur Özetine Geç"
              : "Devam — Sonraki Kategori"}
        </button>
      ) : (
        <p className="text-center text-sm text-text-muted">
          {active
            ? "Oylama bitene kadar bekle…"
            : categorySecLeft != null && categorySecLeft > 0
              ? `İnceleme: ${categorySecLeft}s`
              : "Kurucu sonraki kategoriye geçirene kadar bekle…"}
        </p>
      )}
      {error && <p className="text-center text-sm text-danger">{error}</p>}
    </div>
  );
}
