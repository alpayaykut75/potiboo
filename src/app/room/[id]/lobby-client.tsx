"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { GAME } from "@/lib/constants";
import {
  fetchRoom,
  fetchRoomPlayers,
  startGame,
  updateRoomSettings,
} from "@/lib/rooms/api";
import type {
  Room,
  RoomPlayerWithProfile,
  RoomSettings,
} from "@/lib/rooms/types";
import { AvatarImage } from "@/components/avatar-image";
import { useProfile } from "@/components/profile-gate";
import { GameClient } from "./game-client";
import { clsx } from "@/lib/utils";

const DURATION_OPTIONS = [45, 60, 90];
const ROUND_OPTIONS = [1, 3, 5, 7];
const BASE_CATEGORIES = [...GAME.defaultCategories];
const EXTRA_CATEGORIES = [...GAME.extraCategories];

export function LobbyClient({
  roomId,
  initialRoom,
  initialPlayers,
  joinUrl,
}: {
  roomId: string;
  initialRoom: Room;
  initialPlayers: RoomPlayerWithProfile[];
  joinUrl: string;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [shareHint, setShareHint] = useState<string | null>(null);

  const isHost = room.host_id === profile.userId;
  const canStart = players.length >= GAME.minPlayers && players.length <= GAME.maxPlayers;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 512,
      margin: 1,
      color: { dark: "#0a0f14", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [joinUrl]);

  useEffect(() => {
    const supabase = createClient();

    const refresh = async () => {
      try {
        const [nextRoom, nextPlayers] = await Promise.all([
          fetchRoom(roomId),
          fetchRoomPlayers(roomId),
        ]);
        if (nextRoom) setRoom(nextRoom);
        setPlayers(nextPlayers);
      } catch (e) {
        console.warn(e);
      }
    };

    const channel = supabase
      .channel(`lobby:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    if (room.status === "playing" || room.status === "finished") {
      setError(null);
    }
  }, [room.status]);

  const settings = room.settings as RoomSettings;

  function patchSettings(patch: Partial<RoomSettings>) {
    if (!isHost) return;
    const next = { ...settings, ...patch };
    setRoom((r) => ({ ...r, settings: next }));
    startTransition(async () => {
      try {
        await updateRoomSettings(roomId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ayar kaydedilemedi");
      }
    });
  }

  async function onShare() {
    setShareHint(null);
    const data = {
      title: "Potiboo",
      text: `Potiboo odasına katıl! PIN: ${room.pin}`,
      url: joinUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(`${data.text}\n${joinUrl}`);
      setShareHint("Link kopyalandı");
    } catch {
      try {
        await navigator.clipboard.writeText(joinUrl);
        setShareHint("Link kopyalandı");
      } catch {
        setShareHint("Paylaşım desteklenmiyor");
      }
    }
  }

  function onStart() {
    setError(null);
    startTransition(async () => {
      try {
        await startGame(roomId);
        const next = await fetchRoom(roomId);
        if (next) setRoom(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Başlatılamadı");
      }
    });
  }

  const playerLabel = useMemo(
    () => `${players.length} / ${GAME.maxPlayers} oyuncu`,
    [players.length],
  );

  if (room.status === "playing" || room.status === "finished") {
    return (
      <GameClient
        roomId={roomId}
        initialRoom={room}
        initialPlayers={players}
      />
    );
  }

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
        <span className="text-sm text-text-dim">{playerLabel}</span>
      </header>

      <section className="card flex flex-col items-center gap-4 p-5">
        <p className="text-sm text-text-muted">Oda PIN</p>
        <p className="font-mono text-5xl font-extrabold tracking-[0.35em] text-text">
          {room.pin}
        </p>

        <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="Katılım karekodu"
              className="h-44 w-44 rounded-2xl bg-white p-2"
            />
          ) : (
            <div className="h-44 w-44 animate-pulse rounded-2xl bg-bg-elevated" />
          )}
        </div>

        <button type="button" className="btn btn-secondary w-full" onClick={onShare}>
          Linki Paylaş
        </button>
        {shareHint && (
          <p className="text-xs text-accent">{shareHint}</p>
        )}
        {joinUrl.includes("192.") || joinUrl.includes("10.") ? (
          <p className="break-all text-center text-[11px] text-text-dim">
            Telefon aynı Wi‑Fi&apos;de olsun: {joinUrl}
          </p>
        ) : joinUrl.includes("localhost") ? (
          <p className="text-center text-[11px] text-warning">
            Karekod localhost içeriyor — telefonda açılmaz. .env.local içine
            NEXT_PUBLIC_LAN_HOST ekle ve dev sunucusunu yeniden başlat.
          </p>
        ) : null}
      </section>

      {isHost && (
        <section className="card space-y-3 p-4">
          <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
            Ayarlar
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-1 min-w-[7rem] flex-col gap-1 text-xs text-text-muted">
              Süre
              <select
                className="rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm font-semibold text-text"
                value={settings.duration}
                onChange={(e) =>
                  patchSettings({ duration: Number(e.target.value) })
                }
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} sn
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 min-w-[7rem] flex-col gap-1 text-xs text-text-muted">
              Tur
              <select
                className="rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm font-semibold text-text"
                value={settings.roundCount}
                onChange={(e) =>
                  patchSettings({ roundCount: Number(e.target.value) })
                }
              >
                {ROUND_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} tur
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-text">
            <span>Hız bonusu</span>
            <input
              type="checkbox"
              checked={settings.speedBonus}
              onChange={(e) => patchSettings({ speedBonus: e.target.checked })}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>

          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              Kategoriler
              <span className="text-text-dim">
                {" "}
                · +{GAME.maxExtraCategories} ilave
              </span>
            </p>
            <p className="text-xs text-text-dim">
              {BASE_CATEGORIES.join(", ")}
            </p>
            <div className="flex flex-wrap gap-2">
              {EXTRA_CATEGORIES.map((cat) => {
                const selected = settings.categories.includes(cat);
                const extraCount = settings.categories.filter((c) =>
                  (EXTRA_CATEGORIES as readonly string[]).includes(c),
                ).length;
                const atLimit =
                  !selected && extraCount >= GAME.maxExtraCategories;
                return (
                  <button
                    key={cat}
                    type="button"
                    disabled={atLimit}
                    onClick={() => {
                      const extras = selected
                        ? settings.categories.filter(
                            (c) =>
                              (EXTRA_CATEGORIES as readonly string[]).includes(
                                c,
                              ) && c !== cat,
                          )
                        : [
                            ...settings.categories.filter((c) =>
                              (
                                EXTRA_CATEGORIES as readonly string[]
                              ).includes(c),
                            ),
                            cat,
                          ];
                      patchSettings({
                        categories: [...BASE_CATEGORIES, ...extras],
                      });
                    }}
                    className={clsx(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      selected
                        ? "bg-accent text-[#041018]"
                        : "border border-border bg-bg-elevated text-text-muted",
                      atLimit && "opacity-40",
                    )}
                  >
                    {selected ? `✓ ${cat}` : `+ ${cat}`}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
          Oyuncular
        </p>
        <ul className="space-y-2">
          {players.map((p) => {
            const name = p.profiles?.display_name ?? "Oyuncu";
            const avatar = p.profiles?.avatar_key ?? "panda";
            const host = p.profile_id === room.host_id;
            const me = p.profile_id === profile.userId;
            return (
              <li
                key={p.id}
                className={clsx(
                  "card flex items-center gap-3 px-3 py-2.5",
                  !p.is_connected && "opacity-50",
                )}
              >
                <AvatarImage avatar={avatar} size="md" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-semibold text-text">
                    {name}
                    {me ? " (sen)" : ""}
                  </p>
                  <p className="text-xs text-text-dim">
                    {host ? "Kurucu" : `Sıra ${p.join_order}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-center text-sm text-danger">
          {error}
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={!canStart || pending}
          onClick={onStart}
        >
          {canStart
            ? pending
              ? "Başlatılıyor…"
              : "Başlat"
            : `Başlat (en az ${GAME.minPlayers} oyuncu)`}
        </button>
      ) : (
        <p className="text-center text-sm text-text-muted">
          Kurucu başlatana kadar bekle…
        </p>
      )}
    </div>
  );
}
