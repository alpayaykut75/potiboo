"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/profile-gate";
import { AvatarImage } from "@/components/avatar-image";
import {
  fetchSynkedState,
  synkedRematch,
  synkedSubmitWord,
} from "@/lib/games/synked-api";
import type { SynkedGameRow, SynkedMatchRow } from "@/lib/games/synked";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { clsx } from "@/lib/utils";
import { playSfx, unlockSfx } from "@/lib/sfx";

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
  const router = useRouter();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<SynkedGameRow | null>(null);
  const [match, setMatch] = useState<SynkedMatchRow | null>(null);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  const isHost = room.host_id === profile.userId;
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
  const weWon =
    isTeams && matchFinished && match?.winner_team === myTeam;
  const weLost =
    isTeams && matchFinished && match?.winner_team !== null && match.winner_team !== myTeam;

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

  const showRematch =
    isHost &&
    (matchFinished || game?.phase === "won");

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
          onClick={() => router.push("/")}
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
              {rivalPhase === "won" || match?.winner_team === (myTeam === 0 ? 1 : 0)
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

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
