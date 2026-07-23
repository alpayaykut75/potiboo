"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProfileGate } from "@/components/profile-gate";
import { joinRoomByPin } from "@/lib/rooms/api";

function JoinInner() {
  const params = useParams<{ pin: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const room = await joinRoomByPin(params.pin);
        if (cancelled) return;
        router.replace(`/room/${room.id}`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Katılım başarısız");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.pin, router]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-danger">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => router.push("/")}>
          Ana ekran
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
      Odaya katılıyor…
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
