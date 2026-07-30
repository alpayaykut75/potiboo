"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { GAME } from "@/lib/constants";
import {
  closeRoom,
  fetchRoom,
  fetchRoomPlayers,
  kickPlayer,
  leaveRoom,
  startGame,
  updateRoomSettings,
} from "@/lib/rooms/api";
import type {
  Room,
  RoomPlayerWithProfile,
  RoomSettings,
} from "@/lib/rooms/types";
import { AvatarImage } from "@/components/avatar-image";
import { useLocale } from "@/components/i18n/locale-provider";
import { useProfile } from "@/components/profile-gate";
import { GameClient } from "./game-client";
import { XoxGameClient } from "./xox-client";
import { SynkedGameClient } from "./synked-client";
import { clsx } from "@/lib/utils";
import { gameTitle } from "@/lib/games/catalog";
import { gamePlayerLimits } from "@/lib/games/limits";
import { formatPinDisplay } from "@/lib/rooms/pin";
import { playSfx, unlockSfx } from "@/lib/sfx";
import {
  defaultWinLength,
  xoxBoardLabel,
  type XoxBoardSize,
} from "@/lib/games/xox";

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
  const { t, href } = useLocale();
  const { profile } = useProfile();
  const [room, setRoom] = useState(initialRoom);
  const [players, setPlayers] = useState(initialPlayers);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const prevPlayerIds = useRef<Set<string>>(
    new Set(initialPlayers.map((p) => p.profile_id)),
  );

  const isHost = room.host_id === profile.userId;
  const limits = gamePlayerLimits(room.game_type);
  const isXox = room.game_type === "xox";
  const isSynked = room.game_type === "synked";
  const isIsimSehir = room.game_type === "isim_sehir";
  const canStart = isSynked
    ? players.length === 2 || players.length === 4
    : isXox
      ? players.length === 2 || players.length === 4 || players.length === 8
      : players.length >= limits.min && players.length <= limits.max;

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
        if (!nextRoom) {
          router.replace(href("/"));
          return;
        }
        setRoom(nextRoom);
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
          event: "*",
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
  }, [roomId, router]);

  useEffect(() => {
    if (room.status === "playing" || room.status === "finished") {
      setError(null);
    }
  }, [room.status]);

  // Yeni oyuncu girişi
  useEffect(() => {
    const next = new Set(players.map((p) => p.profile_id));
    for (const id of next) {
      if (prevPlayerIds.current.has(id)) continue;
      if (id === profile.userId) continue;
      void unlockSfx().then(() => playSfx("tap"));
    }
    prevPlayerIds.current = next;
  }, [players, profile.userId]);

  // Atıldın / oda silindi
  useEffect(() => {
    if (room.status !== "lobby") return;
    if (players.length === 0) return;
    const stillIn = players.some((p) => p.profile_id === profile.userId);
    if (!stillIn) router.replace(href("/"));
  }, [players, profile.userId, room.status, router]);

  const settings = room.settings as RoomSettings;

  const estimatedMin = useMemo(() => {
    if (!isIsimSehir) return null;
    const sec = settings.duration * settings.roundCount;
    return Math.max(1, Math.round(sec / 60));
  }, [isIsimSehir, settings.duration, settings.roundCount]);

  const settingsSummary = useMemo(() => {
    if (isIsimSehir) {
      return t("lobby.settingsSummaryIsim", {
        duration: settings.duration,
        rounds: settings.roundCount,
        cats: settings.categories.length,
      });
    }
    if (isXox && players.length < 4) {
      return t("lobby.settingsSummaryXox", {
        board: xoxBoardLabel((settings.boardSize ?? 3) as XoxBoardSize),
      });
    }
    if (isXox) return t("lobby.settingsSummaryTournament");
    return null;
  }, [isIsimSehir, isXox, players.length, settings, t]);

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
      title: gameTitle(room.game_type),
      text: gameTitle(room.game_type),
      url: joinUrl,
    };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(joinUrl);
      setShareHint(t("lobby.linkCopied"));
    } catch (e) {
      // Kullanıcı native sheet'i iptal ettiyse sessiz kal
      if (e instanceof DOMException && e.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(joinUrl);
        setShareHint(t("lobby.linkCopied"));
      } catch {
        setShareHint(t("lobby.shareUnsupported"));
      }
    }
  }

  async function onCopyPin() {
    try {
      await navigator.clipboard.writeText(room.pin);
      setShareHint(t("common.copied"));
    } catch {
      setShareHint(t("common.copyFailed"));
    }
  }

  function onStart() {
    if (!canStart) return;
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

  function onKick(profileId: string) {
    startTransition(async () => {
      try {
        await kickPlayer(roomId, profileId);
        setPlayers(await fetchRoomPlayers(roomId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Çıkarılamadı");
      }
    });
  }

  function onLeave() {
    startTransition(async () => {
      try {
        await leaveRoom(roomId);
        router.replace(href("/"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ayrılamadı");
      }
    });
  }

  function onCloseRoom() {
    startTransition(async () => {
      try {
        await closeRoom(roomId);
        router.replace(href("/"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Kapatılamadı");
        setCloseConfirm(false);
      }
    });
  }

  const emptySlots = Math.max(0, limits.max - players.length);

  if (room.status === "playing" || room.status === "finished") {
    if (isXox) {
      return (
        <XoxGameClient
          roomId={roomId}
          initialRoom={room}
          initialPlayers={players}
        />
      );
    }
    if (isSynked) {
      return (
        <SynkedGameClient
          roomId={roomId}
          initialRoom={room}
          initialPlayers={players}
        />
      );
    }
    return (
      <GameClient
        roomId={roomId}
        initialRoom={room}
        initialPlayers={players}
      />
    );
  }

  const qrBlock = (
    <div className="flex justify-end">
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={t("lobby.qrAlt")}
          className="h-28 w-28 rounded-xl bg-white p-1.5 sm:h-32 sm:w-32"
        />
      ) : (
        <div className="h-28 w-28 animate-pulse rounded-xl bg-bg-elevated sm:h-32 sm:w-32" />
      )}
    </div>
  );

  const linkBlock = (
    <button
      type="button"
      className="btn btn-secondary px-4 py-2.5 text-sm"
      onClick={() => void onShare()}
    >
      {t("lobby.shareLink")}
    </button>
  );

  const pinBlock = (
    <button
      type="button"
      onClick={() => void onCopyPin()}
      className="font-mono text-base font-bold tracking-[0.16em] text-text-muted transition hover:text-accent"
      title={t("common.copy")}
      aria-label={t("lobby.copyPin")}
    >
      {t("lobby.pinPrefix")} {formatPinDisplay(room.pin)}
    </button>
  );

  function inviteRow(label: string, action: ReactNode) {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="shrink-0 text-sm font-medium text-text-muted">{label}</p>
        <div className="min-w-0">{action}</div>
      </div>
    );
  }

  const lanHint =
    joinUrl.includes("192.") || joinUrl.includes("10.") ? (
      <p className="break-all text-center text-[11px] text-text-dim">
        {t("lobby.lanHint", { url: joinUrl })}
      </p>
    ) : joinUrl.includes("localhost") ? (
      <p className="text-center text-[11px] text-warning">
        {t("lobby.localhostHint")}
      </p>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        {isHost ? (
          <button
            type="button"
            className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
            onClick={() => setCloseConfirm(true)}
          >
            {t("lobby.closeRoom")}
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost rounded-xl px-2 py-1 text-sm text-text-muted"
            disabled={pending}
            onClick={onLeave}
          >
            {t("lobby.leave")}
          </button>
        )}
        <span className="text-sm font-semibold text-accent">
          {gameTitle(room.game_type)}
        </span>
      </header>

      <section className="card flex flex-col gap-4 p-5">
        {/* Mobil: link → karekod → PIN · Masaüstü: karekod → link → PIN */}
        <div className="flex flex-col gap-4 md:hidden">
          {inviteRow(t("lobby.inviteRemote"), linkBlock)}
          {inviteRow(t("lobby.inviteNearby"), qrBlock)}
          {inviteRow(t("lobby.inviteAlready"), pinBlock)}
        </div>
        <div className="hidden flex-col gap-4 md:flex">
          {inviteRow(t("lobby.inviteNearby"), qrBlock)}
          {inviteRow(t("lobby.inviteRemote"), linkBlock)}
          {inviteRow(t("lobby.inviteAlready"), pinBlock)}
        </div>
        {shareHint && (
          <p className="text-center text-[11px] text-accent">{shareHint}</p>
        )}
        {lanHint}
      </section>

      {!isHost && isXox && (
        <p className="text-center text-sm text-text-muted">
          {t("lobby.xoxGuestHint")}
          {players.length <= 2
            ? ` · ${xoxBoardLabel((settings.boardSize ?? 3) as XoxBoardSize)}`
            : " · 3×3"}
        </p>
      )}

      {!isHost && isSynked && (
        <p className="text-center text-sm text-text-muted">
          {t("lobby.synkedGuestHint")}
        </p>
      )}

      {/* Ayarlar — katlanır */}
      {isHost && (isIsimSehir || isXox) && settingsSummary && (
        <section className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-text"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <span>⚙ {settingsSummary}</span>
            <span className="text-text-dim" aria-hidden>
              {settingsOpen ? "−" : "+"}
            </span>
          </button>

          {settingsOpen && isXox && (
            <div className="space-y-3 border-t border-border/60 px-4 py-3">
              {players.length >= 4 ? (
                <>
                  <p className="rounded-xl bg-accent/15 px-3 py-2.5 text-sm font-bold text-accent">
                    {t("lobby.tournamentMode", { n: players.length })}
                  </p>
                  <p className="text-xs text-text-dim">
                    {t("lobby.tournamentHint")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-text-muted">
                    {t("lobby.xoxHostHint")}
                  </p>
                  <p className="text-xs text-text-muted">{t("lobby.board")}</p>
                  <div className="flex flex-wrap gap-2">
                    {([3, 5, 0] as const).map((size) => {
                      const selected = (settings.boardSize ?? 3) === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() =>
                            patchSettings({
                              boardSize: size,
                              winLength: defaultWinLength(size),
                            })
                          }
                          className={clsx(
                            "min-w-[4.5rem] flex-1 rounded-xl px-3 py-2.5 text-sm font-bold transition",
                            selected
                              ? "bg-accent text-[#041018]"
                              : "border border-border bg-bg-elevated text-text-muted",
                          )}
                        >
                          {xoxBoardLabel(size)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {settingsOpen && isIsimSehir && (
            <div className="space-y-3 border-t border-border/60 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <label className="flex min-w-[7rem] flex-1 flex-col gap-1 text-xs text-text-muted">
                  {t("lobby.duration")}
                  <select
                    className="rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm font-semibold text-text"
                    value={settings.duration}
                    onChange={(e) =>
                      patchSettings({ duration: Number(e.target.value) })
                    }
                  >
                    {DURATION_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {t("lobby.seconds", { n: d })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[7rem] flex-1 flex-col gap-1 text-xs text-text-muted">
                  {t("lobby.rounds")}
                  <select
                    className="rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm font-semibold text-text"
                    value={settings.roundCount}
                    onChange={(e) =>
                      patchSettings({ roundCount: Number(e.target.value) })
                    }
                  >
                    {ROUND_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-3 text-sm text-text">
                  <span>{t("lobby.speedBonus")}</span>
                  <input
                    type="checkbox"
                    checked={settings.speedBonus}
                    onChange={(e) =>
                      patchSettings({ speedBonus: e.target.checked })
                    }
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                </span>
                <span className="text-xs text-text-dim">
                  {t("lobby.speedBonusHint")}
                </span>
              </label>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-text-muted">
                  {t("lobby.categories", {
                    n: settings.categories.length,
                    max: BASE_CATEGORIES.length + GAME.maxExtraCategories,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {BASE_CATEGORIES.map((cat) => (
                    <span
                      key={cat}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-[#041018]"
                    >
                      {cat}
                    </span>
                  ))}
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
                                  (
                                    EXTRA_CATEGORIES as readonly string[]
                                  ).includes(c) && c !== cat,
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
                            : "border border-border/70 bg-transparent text-text-dim",
                          atLimit && "opacity-40",
                        )}
                      >
                        {selected ? `× ${cat}` : `+ ${cat}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {estimatedMin != null && (
                <p className="text-xs text-text-dim">
                  {t("lobby.estimated", { n: estimatedMin })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {isHost && isSynked && (
        <section className="card space-y-2 p-4">
          <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
            {t("lobby.howTo")}
          </p>
          <p className="text-sm text-text-muted">{t("lobby.synkedHowTo")}</p>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-text-dim uppercase">
          {t("lobby.players", { n: players.length, max: limits.max })}
        </p>
        <ul className="space-y-2">
          {players.map((p) => {
            const name = p.profiles?.display_name ?? t("common.player");
            const avatar = p.profiles?.avatar_key ?? "panda";
            const host = p.profile_id === room.host_id;
            const me = p.profile_id === profile.userId;
            return (
              <li
                key={p.id}
                className={clsx(
                  "card flex animate-[rise_0.35s_ease-out] items-center gap-3 px-3 py-2.5",
                  !p.is_connected && "opacity-50",
                )}
              >
                <AvatarImage avatar={avatar} size="md" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-semibold text-text">
                    {name}
                    {me ? ` ${t("common.you")}` : ""}
                  </p>
                  <p className="text-xs text-text-dim">
                    {host ? t("common.host") : t("lobby.order", { n: p.join_order })}
                  </p>
                </div>
                {isHost && !me && (
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                    disabled={pending}
                    onClick={() => onKick(p.profile_id)}
                    aria-label={`${name} ${t("lobby.kick")}`}
                  >
                    {t("lobby.kick")}
                  </button>
                )}
              </li>
            );
          })}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <li
              key={`empty-${i}`}
              className="flex items-center gap-3 rounded-2xl border border-dashed border-border/70 px-3 py-2.5 opacity-45"
            >
              <div className="h-10 w-10 rounded-full bg-bg-elevated" />
              <p className="text-sm text-text-dim">{t("lobby.emptySeat")}</p>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-danger/15 px-3 py-2 text-center text-sm text-danger"
        >
          {error}
        </p>
      )}

      {isHost ? (
        <div className="flex flex-col gap-2">
          {!canStart && (
            <p className="text-center text-sm text-text-muted">
              {t("lobby.waitingFriends")}
            </p>
          )}
          <button
            type="button"
            className={clsx(
              "btn w-full transition",
              canStart
                ? "btn-primary scale-100 shadow-[0_12px_28px_-8px_rgba(61,157,196,0.55)]"
                : "cursor-not-allowed border border-border bg-bg-elevated text-text-dim opacity-60",
            )}
            disabled={!canStart || pending}
            onClick={onStart}
          >
            {pending ? t("lobby.starting") : t("lobby.startGame")}
          </button>
        </div>
      ) : (
        <p className="text-center text-sm text-text-muted">
          {t("lobby.waitHost")}
        </p>
      )}

      {closeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5">
          <div className="card w-full max-w-sm space-y-4 p-5">
            <p className="text-center text-base font-bold text-text">
              {t("lobby.closeConfirm")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => setCloseConfirm(false)}
              >
                {t("lobby.cancel")}
              </button>
              <button
                type="button"
                className="btn flex-1 bg-danger text-white"
                disabled={pending}
                onClick={onCloseRoom}
              >
                {t("lobby.closeRoom")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
