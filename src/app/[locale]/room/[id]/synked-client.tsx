"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/components/i18n/locale-provider";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import { InstallHint } from "@/components/pwa/install-hint";
import {
  fetchSynkedState,
  synkedRaceRematch,
  synkedRaceStop,
  synkedRaceSubmitWord,
  synkedRematch,
  synkedSubmitWord,
} from "@/lib/games/synked-api";
import type { SynkedGameRow, SynkedMatchRow } from "@/lib/games/synked";
import {
  SYNKED_SEED_POOL,
  type SynkedRaceRow,
} from "@/lib/games/synked-race";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

function playerName(
  players: RoomPlayerWithProfile[],
  id: string | null,
): string {
  if (!id) return "?";
  return (
    players.find((p) => p.profile_id === id)?.profiles?.display_name ?? "?"
  );
}

function playerAvatar(
  players: RoomPlayerWithProfile[],
  id: string | null,
): string {
  if (!id) return "panda";
  return (
    players.find((p) => p.profile_id === id)?.profiles?.avatar_key ?? "panda"
  );
}

export function SynkedGameClient({
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
  const [game, setGame] = useState<SynkedGameRow | null>(null);
  const [match, setMatch] = useState<SynkedMatchRow | null>(null);
  const [race, setRace] = useState<SynkedRaceRow | null>(null);
  const [word, setWord] = useState("");
  const [spinWord, setSpinWord] = useState<string>(SYNKED_SEED_POOL[0]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastWinPhase = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextRoom, nextPlayers, state] = await Promise.all([
      fetchRoom(roomId),
      fetchRoomPlayers(roomId),
      fetchSynkedState(roomId),
    ]);
    if (nextRoom) setRoom(nextRoom);
    setPlayers(nextPlayers);
    setGame(state.game);
    setMatch(state.match);
    setRace(state.race);
  }, [roomId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "Yüklenemedi"),
    );
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`synked:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "synked_games",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "synked_matches",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "synked_races",
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
    setWord("");
  }, [game?.phase, game?.round]);

  useEffect(() => {
    if (!race || (race.phase !== "spin1" && race.phase !== "spin2")) return;
    const id = window.setInterval(() => {
      const next =
        SYNKED_SEED_POOL[Math.floor(Math.random() * SYNKED_SEED_POOL.length)]!;
      setSpinWord(next);
    }, 70);
    return () => window.clearInterval(id);
  }, [race?.phase, race?.seed1]);

  useEffect(() => {
    if (race?.phase === "finished" && lastWinPhase.current !== race.updated_at) {
      lastWinPhase.current = race.updated_at;
      void unlockSfx().then(() => playSfx("countdownGo"));
    }
  }, [race?.phase, race?.updated_at]);

  useEffect(() => {
    if (race?.phase === "race") setWord("");
  }, [race?.phase, race?.round]);

  const isHost = room.host_id === profile.userId;

  // ——— 4p yarış ———
  if (race) {
    const onT0 =
      profile.userId === race.team0_a || profile.userId === race.team0_b;
    const onT1 =
      profile.userId === race.team1_a || profile.userId === race.team1_b;
    const canDur =
      (race.phase === "spin1" && onT0) || (race.phase === "spin2" && onT1);
    const mySlot =
      profile.userId === race.team0_a
        ? "t0a"
        : profile.userId === race.team0_b
          ? "t0b"
          : profile.userId === race.team1_a
            ? "t1a"
            : profile.userId === race.team1_b
              ? "t1b"
              : null;
    const iAmReady =
      mySlot === "t0a"
        ? race.ready_t0a
        : mySlot === "t0b"
          ? race.ready_t0b
          : mySlot === "t1a"
            ? race.ready_t1a
            : mySlot === "t1b"
              ? race.ready_t1b
              : false;
    const allReady =
      race.ready_t0a &&
      race.ready_t0b &&
      race.ready_t1a &&
      race.ready_t1b;
    const canSubmit =
      race.phase === "race" && mySlot != null && !iAmReady && !allReady;
    const racePhase = race.phase;

    function onDur() {
      if (!canDur || pending) return;
      setError(null);
      void unlockSfx().then(() => playSfx("tap"));
      const locked = spinWord;
      startTransition(async () => {
        try {
          const next = await synkedRaceStop(roomId, locked);
          setRace(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : "DUR başarısız");
          void refresh();
        }
      });
    }

    function onRaceSubmit(e: FormEvent) {
      e.preventDefault();
      if (!canSubmit || !word.trim()) return;
      setError(null);
      void unlockSfx().then(() => playSfx("tap"));
      const next = word.trim();
      startTransition(async () => {
        try {
          const result = await synkedRaceSubmitWord(roomId, next);
          setRace(result);
          setWord("");
          if (result.phase === "finished") {
            playSfx("countdownGo");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Gönderilemedi");
          void refresh();
        }
      });
    }

    function onRaceRematch() {
      setError(null);
      startTransition(async () => {
        try {
          const next = await synkedRaceRematch(roomId);
          setRace(next);
          setWord("");
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Yeniden başlatılamadı",
          );
        }
      });
    }

    let statusText = "Yükleniyor…";
    if (race.phase === "spin1") {
      statusText = canDur
        ? "Takım A — DUR’a bas, tohum kilitle"
        : "Takım A kelime seçiyor…";
    } else if (race.phase === "spin2") {
      statusText = canDur
        ? "Takım B — DUR’a bas, tohum kilitle"
        : "Takım B kelime seçiyor…";
    } else if (race.phase === "race") {
      if (iAmReady) statusText = "Diğerleri bekleniyor…";
      else statusText = "Çağrışımını yaz — herkes gönderince açılır";
    } else if (race.phase === "finished") {
      statusText =
        race.winner_team === 0
          ? "Takım A kazandı!"
          : race.winner_team === 1
            ? "Takım B kazandı!"
            : "Berabere!";
    }

    const hasReveal =
      Boolean(race.live_t0a) ||
      Boolean(race.live_t0b) ||
      Boolean(race.live_t1a) ||
      Boolean(race.live_t1b);

    function Seat({
      id,
      live,
      ready,
      accent,
    }: {
      id: string | null;
      live: string;
      ready: boolean;
      accent: string;
    }) {
      const mine = id === profile.userId;
      return (
        <div
          className={clsx(
            "flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl px-2 py-2.5",
            mine && "ring-2 ring-accent/60",
            ready && racePhase === "race" && "ring-2 ring-accent",
          )}
        >
          <AvatarImage avatar={playerAvatar(players, id)} size="lg" />
          <p className="max-w-full truncate text-sm font-bold text-text">
            {playerName(players, id)}
          </p>
          {racePhase === "race" ? (
            <span className="text-sm font-semibold text-text-muted">
              {ready ? "Hazır" : "Yazıyor"}
            </span>
          ) : (
            <p
              className={clsx(
                "min-h-[1.5rem] max-w-full truncate text-base font-extrabold",
                live ? "text-text" : "text-text-dim",
              )}
              style={live ? { color: accent } : undefined}
            >
              {live || "…"}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-5">
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-ghost rounded-xl px-2 py-1 text-base text-text-muted"
            onClick={() => router.push(href("/"))}
          >
            ← Çık
          </button>
          <span className="text-base font-semibold text-[#c47bb8]">
            Synked · Yarış
          </span>
        </header>

        <p className="text-center text-xl font-bold text-text">{statusText}</p>

        {(race.phase === "spin1" || race.phase === "spin2") && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="relative flex h-28 w-full max-w-xs items-center justify-center overflow-hidden rounded-3xl bg-bg-elevated">
              <span
                key={spinWord}
                className="synked-spin-word text-4xl font-black tracking-wide text-accent"
              >
                {spinWord}
              </span>
            </div>
            {race.seed1 && (
              <p className="text-base text-text-muted">
                Tohum 1:{" "}
                <span className="font-bold text-accent">{race.seed1}</span>
              </p>
            )}
            {canDur ? (
              <button
                type="button"
                className="btn btn-primary min-w-[10rem] text-2xl font-black tracking-widest"
                disabled={pending}
                onClick={onDur}
              >
                DUR
              </button>
            ) : (
              <p className="text-base text-text-dim">Sıra diğer takımda</p>
            )}
          </div>
        )}

        {(race.phase === "race" || race.phase === "finished") && (
          <>
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
                Tohum
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-2xl bg-bg-card px-4 py-2 text-lg font-extrabold text-accent">
                  {race.seed1}
                </span>
                <span className="text-text-dim">·</span>
                <span className="rounded-2xl bg-bg-card px-4 py-2 text-lg font-extrabold text-[#c47bb8]">
                  {race.seed2}
                </span>
              </div>
            </div>

            {hasReveal && (
              <div className="flex flex-col gap-3">
                <p className="text-center text-sm font-semibold text-text-muted">
                  {race.phase === "finished"
                    ? "Son kelimeler"
                    : `Tur ${Math.max(1, race.round - 1)} — bunlara göre yaz`}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col items-center gap-2 rounded-3xl border border-border bg-bg-card/80 px-3 py-3">
                    <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
                      Takım A
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="rounded-2xl bg-bg-elevated px-3 py-2 text-xl font-extrabold text-accent">
                        {race.live_t0a || "—"}
                      </span>
                      <span className="text-text-dim">·</span>
                      <span className="rounded-2xl bg-bg-elevated px-3 py-2 text-xl font-extrabold text-accent">
                        {race.live_t0b || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2 rounded-3xl border border-border bg-bg-card/80 px-3 py-3">
                    <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
                      Takım B
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="rounded-2xl bg-bg-elevated px-3 py-2 text-xl font-extrabold text-[#c47bb8]">
                        {race.live_t1a || "—"}
                      </span>
                      <span className="text-text-dim">·</span>
                      <span className="rounded-2xl bg-bg-elevated px-3 py-2 text-xl font-extrabold text-[#c47bb8]">
                        {race.live_t1b || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {race.phase === "race" && (
              <p className="text-center text-sm font-semibold text-text-dim">
                Tur {race.round}
                {hasReveal ? " · yeni çağrışım" : ""}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <section
                className={clsx(
                  "rounded-3xl border px-3 py-3",
                  race.winner_team === 0
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg-elevated/60",
                )}
              >
                <p className="mb-2 text-center text-xs font-semibold tracking-wide text-text-dim uppercase">
                  Takım A
                </p>
                <div className="flex gap-1">
                  <Seat
                    id={race.team0_a}
                    live={race.live_t0a}
                    ready={race.ready_t0a}
                    accent="#5bb8a8"
                  />
                  <Seat
                    id={race.team0_b}
                    live={race.live_t0b}
                    ready={race.ready_t0b}
                    accent="#5bb8a8"
                  />
                </div>
              </section>

              <section
                className={clsx(
                  "rounded-3xl border px-3 py-3",
                  race.winner_team === 1
                    ? "border-[#c47bb8] bg-[#c47bb8]/10"
                    : "border-border bg-bg-elevated/60",
                )}
              >
                <p className="mb-2 text-center text-xs font-semibold tracking-wide text-text-dim uppercase">
                  Takım B
                </p>
                <div className="flex gap-1">
                  <Seat
                    id={race.team1_a}
                    live={race.live_t1a}
                    ready={race.ready_t1a}
                    accent="#c47bb8"
                  />
                  <Seat
                    id={race.team1_b}
                    live={race.live_t1b}
                    ready={race.ready_t1b}
                    accent="#c47bb8"
                  />
                </div>
              </section>
            </div>

            {canSubmit && (
              <form onSubmit={onRaceSubmit} className="flex flex-col gap-3">
                <input
                  type="text"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  maxLength={40}
                  autoComplete="off"
                  autoCapitalize="none"
                  placeholder="Yeni kelime…"
                  className="w-full rounded-2xl border-2 border-border-strong bg-bg-card px-4 py-3.5 text-center text-xl font-bold text-text outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="btn btn-primary w-full text-lg"
                  disabled={pending || !word.trim()}
                >
                  {pending ? "Gönderiliyor…" : "Gönder"}
                </button>
              </form>
            )}

            {iAmReady && race.phase === "race" && (
              <p className="text-center text-base text-text-muted">
                Kelimen kilitli
                {race.my_word ? `: “${race.my_word}”` : ""}
              </p>
            )}
          </>
        )}

        {race.phase === "finished" && isHost && (
          <button
            type="button"
            className="btn btn-primary w-full text-lg"
            disabled={pending}
            onClick={onRaceRematch}
          >
            Yeniden oyna
          </button>
        )}
        {race.phase === "finished" && !isHost && (
          <p className="text-center text-base text-text-muted">
            Kurucu yeniden başlatabilir.
          </p>
        )}

        {error && (
          <p role="alert" className="text-center text-base text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ——— 2p klasik (ve eski teams kalıntısı) ———
  const isTeams = match?.mode === "teams";
  const myTeam = game?.team_id ?? 0;
  const isA = game?.player_a === profile.userId;
  const isB = game?.player_b === profile.userId;
  const iAmReady = isA
    ? Boolean(game?.ready_a)
    : isB
      ? Boolean(game?.ready_b)
      : false;
  const partnerReady = isA
    ? Boolean(game?.ready_b)
    : isB
      ? Boolean(game?.ready_a)
      : false;

  const matchFinished = match?.status === "finished";
  const weWon = isTeams && matchFinished && match?.winner_team === myTeam;
  const weLost =
    isTeams &&
    matchFinished &&
    match?.winner_team !== null &&
    match.winner_team !== myTeam;

  const canSubmit =
    game != null &&
    (game.phase === "seed" || game.phase === "guess") &&
    (isA || isB) &&
    !iAmReady &&
    !(isTeams && matchFinished);

  const teammateIds = game
    ? [game.player_a, game.player_b].filter(Boolean)
    : [];
  const teammates = players.filter((p) =>
    teammateIds.includes(p.profile_id),
  );
  const opponents = players.filter(
    (p) => !teammateIds.includes(p.profile_id),
  );

  const rivalPhase =
    myTeam === 0 ? match?.team1_phase : match?.team0_phase;
  const rivalRound =
    myTeam === 0 ? match?.team1_round : match?.team0_round;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !word.trim()) return;
    setError(null);
    void unlockSfx().then(() => playSfx("tap"));
    const next = word.trim();
    startTransition(async () => {
      try {
        const result = await synkedSubmitWord(roomId, next);
        setGame(result.game);
        setMatch(result.match);
        if (
          result.game?.phase === "won" ||
          result.match?.status === "finished"
        ) {
          playSfx("countdownGo");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gönderilemedi");
        void refresh();
      }
    });
  }

  function onRematch() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await synkedRematch(roomId);
        setGame(next.game);
        setMatch(next.match);
        setWord("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Yeniden başlatılamadı");
      }
    });
  }

  let statusText = "Yükleniyor…";
  if (weWon) statusText = "Takımın kazandı!";
  else if (weLost) statusText = "Rakip takım önce eşleşti";
  else if (game?.phase === "seed") {
    if (iAmReady && !partnerReady) statusText = "Takım arkadaşın bekleniyor…";
    else if (iAmReady && partnerReady) statusText = "Açılıyor…";
    else statusText = "Başlangıç kelimeni yaz";
  } else if (game?.phase === "guess") {
    if (iAmReady && !partnerReady) statusText = "Takım arkadaşın bekleniyor…";
    else if (iAmReady && partnerReady) statusText = "Karşılaştırılıyor…";
    else statusText = "Bu iki kelime ne çağrıştırıyor?";
  } else if (game?.phase === "won") {
    statusText = isTeams ? "Takımın eşleşti!" : "Eşleştiniz!";
  }

  const guessRounds =
    game?.history.filter((h) => h.kind === "guess" || h.kind === "match")
      .length ?? 0;

  const showRematch = isHost && (matchFinished || game?.phase === "won");

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
          onClick={() => router.push(href("/"))}
        >
          ← Çık
        </button>
        <span className="text-sm font-semibold text-accent">
          Synked{isTeams ? " · 2v2" : ""}
        </span>
      </header>

      <div className="flex flex-col gap-4">
        <div>
          {isTeams && (
            <p className="mb-2 text-center text-[11px] font-semibold tracking-wide text-text-dim uppercase">
              Senin takımın
            </p>
          )}
          <div className="flex items-center justify-center gap-6">
            {teammates.map((p) => {
              const ready =
                p.profile_id === game?.player_a
                  ? game?.ready_a
                  : p.profile_id === game?.player_b
                    ? game?.ready_b
                    : false;
              return (
                <div
                  key={p.id}
                  className={clsx(
                    "flex flex-col items-center gap-2 rounded-2xl px-3 py-2",
                    ready &&
                      game?.phase !== "won" &&
                      !matchFinished &&
                      "ring-2 ring-accent",
                  )}
                >
                  <AvatarImage
                    avatar={p.profiles?.avatar_key ?? "panda"}
                    size="lg"
                  />
                  <p className="max-w-[6rem] truncate text-sm font-bold text-text">
                    {p.profiles?.display_name}
                  </p>
                  {game?.phase !== "won" && !matchFinished && (
                    <span className="text-[11px] text-text-dim">
                      {ready ? "Hazır" : "Yazıyor"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {isTeams && opponents.length > 0 && (
          <div className="rounded-2xl border border-border bg-bg-elevated/50 px-3 py-3">
            <p className="mb-2 text-center text-[11px] font-semibold tracking-wide text-text-dim uppercase">
              Rakip takım
            </p>
            <div className="flex items-center justify-center gap-4">
              {opponents.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col items-center gap-1"
                >
                  <AvatarImage
                    avatar={p.profiles?.avatar_key ?? "panda"}
                    size="md"
                  />
                  <p className="max-w-[5rem] truncate text-xs font-semibold text-text-muted">
                    {p.profiles?.display_name}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-text-dim">
              {rivalPhase === "won" ||
              match?.winner_team === (myTeam === 0 ? 1 : 0)
                ? "Eşleştiler!"
                : rivalPhase === "guess"
                  ? `Tur ${rivalRound ?? 1} · arıyorlar…`
                  : "Tohum yazıyorlar…"}
            </p>
          </div>
        )}
      </div>

      <p className="text-center text-lg font-bold text-text">{statusText}</p>

      {game && (game.phase === "guess" || game.phase === "won") && (
        <div className="flex items-center justify-center gap-3">
          <span className="rounded-2xl bg-bg-card px-4 py-3 text-xl font-extrabold text-accent">
            {game.word_a}
          </span>
          <span className="text-text-dim">·</span>
          <span className="rounded-2xl bg-bg-card px-4 py-3 text-xl font-extrabold text-[#c47bb8]">
            {game.word_b}
          </span>
        </div>
      )}

      {game && game.history.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {game.history.map((h, i) => (
            <span key={`${h.a}-${h.b}-${i}`} className="contents">
              {i > 0 && <span className="text-xs text-text-dim">→</span>}
              <span
                className={clsx(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  h.kind === "match"
                    ? "bg-accent/20 text-accent"
                    : "bg-bg-elevated text-text-muted",
                )}
              >
                {h.a} · {h.b}
              </span>
            </span>
          ))}
        </div>
      )}

      {game?.phase === "won" && !weLost && (
        <p className="text-center text-sm text-text-muted">
          {guessRounds <= 1
            ? "İlk turda tuttu!"
            : `${guessRounds} çağrışım turunda eşleştiniz`}
        </p>
      )}

      {canSubmit && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="none"
            placeholder={
              game?.phase === "seed" ? "Kelimen…" : "Çağrışımın…"
            }
            className="w-full rounded-2xl border-2 border-border-strong bg-bg-card px-4 py-3 text-center text-lg font-bold text-text outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={pending || !word.trim()}
          >
            {pending ? "Gönderiliyor…" : "Gönder"}
          </button>
        </form>
      )}

      {iAmReady && game && game.phase !== "won" && !matchFinished && (
        <p className="text-center text-sm text-text-dim">
          Kelimen kilitli
          {game.my_word ? `: “${game.my_word}”` : ""}
        </p>
      )}

      {showRematch && (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending}
          onClick={onRematch}
        >
          Yeniden oyna
        </button>
      )}

      {(game?.phase === "won" || matchFinished) && !isHost && (
        <p className="text-center text-sm text-text-muted">
          Kurucu yeniden başlatabilir.
        </p>
      )}

      {(game?.phase === "won" || matchFinished) && (
        <InstallHint
          completionId={`synked:${roomId}:${game?.updated_at ?? match?.updated_at ?? "end"}`}
        />
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
