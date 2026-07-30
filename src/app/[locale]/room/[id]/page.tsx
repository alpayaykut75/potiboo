"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProfileGate } from "@/components/profile-gate";
import { useLocale } from "@/components/i18n/locale-provider";
import { LobbyClient } from "./lobby-client";
import { fetchRoom, fetchRoomPlayers } from "@/lib/rooms/api";
import { buildJoinUrl } from "@/lib/rooms/join-url";
import type { Room, RoomPlayerWithProfile } from "@/lib/rooms/types";

function RoomInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t, href, locale } = useLocale();
  const roomId = params.id;
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayerWithProfile[]>([]);
  const [joinUrl, setJoinUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextRoom = await fetchRoom(roomId);
        if (!nextRoom) {
          setError(t("room.notFound"));
          return;
        }
        const nextPlayers = await fetchRoomPlayers(roomId);
        if (cancelled) return;
        setRoom(nextRoom);
        setPlayers(nextPlayers);
        setJoinUrl(buildJoinUrl(nextRoom.pin, locale));
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : t("room.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, locale, t]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
        {t("room.loading")}
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-danger">{error ?? t("room.missing")}</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push(href("/"))}
        >
          {t("common.home")}
        </button>
      </div>
    );
  }

  return (
    <LobbyClient
      roomId={roomId}
      initialRoom={room}
      initialPlayers={players}
      joinUrl={joinUrl}
    />
  );
}

export default function RoomPage() {
  return (
    <ProfileGate>
      <RoomInner />
    </ProfileGate>
  );
}
