"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProfileGate } from "@/components/profile-gate";
import { useLocale } from "@/components/i18n/locale-provider";
import { joinRoomByPin } from "@/lib/rooms/api";
import { PIN_LENGTH } from "@/lib/constants";

function JoinInner() {
  const params = useParams<{ pin: string }>();
  const router = useRouter();
  const { t, href } = useLocale();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const room = await joinRoomByPin(params.pin);
        if (cancelled) return;
        router.replace(href(`/room/${room.id}`));
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "pin_not_found") setError(t("pin.notFound"));
          else if (msg === "pin_wrong_length") {
            setError(t("pin.wrongLength", { n: PIN_LENGTH }));
          } else setError(msg || t("room.joinFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.pin, router, href, t]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-danger">{error}</p>
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
    <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
      {t("room.joining")}
    </div>
  );
}

export default function JoinPage() {
  return (
    <ProfileGate>
      <JoinInner />
    </ProfileGate>
  );
}
