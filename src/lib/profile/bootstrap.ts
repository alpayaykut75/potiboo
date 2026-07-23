"use client";

import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  readLocalProfile,
  writeLocalProfile,
  type PlayerProfile,
} from "@/lib/profile/storage";
import { isAvatarId } from "@/lib/avatars";

function localUserId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      reject(new Error(`${label} zaman aşımı (${ms}ms)`));
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Anonim oturum + profil çözümleme.
 * Hata / zaman aşımında localStorage ile devam eder — ekran kilitlenmez.
 */
export async function bootstrapProfile(): Promise<{
  profile: PlayerProfile | null;
  mode: "supabase" | "local";
}> {
  const local = readLocalProfile();

  if (!isSupabaseConfigured()) {
    return { profile: local, mode: "local" };
  }

  try {
    const supabase = createClient();

    const sessionResult = await withTimeout(
      supabase.auth.getSession(),
      8000,
      "getSession",
    );
    let userId = sessionResult.data.session?.user?.id;

    if (!userId) {
      const anon = await withTimeout(
        supabase.auth.signInAnonymously(),
        10000,
        "signInAnonymously",
      );
      if (anon.error || !anon.data.user) {
        console.warn("Anonim giriş başarısız:", anon.error);
        return { profile: local, mode: "local" };
      }
      userId = anon.data.user.id;
    }

    const { data: remote } = await withTimeout(
      supabase
        .from("profiles")
        .select("display_name, avatar_key")
        .eq("id", userId)
        .maybeSingle(),
      8000,
      "profiles.select",
    );

    if (
      remote?.display_name &&
      remote.avatar_key &&
      isAvatarId(remote.avatar_key)
    ) {
      const profile: PlayerProfile = {
        userId,
        displayName: remote.display_name,
        avatarKey: remote.avatar_key,
      };
      writeLocalProfile(profile);
      return { profile, mode: "supabase" };
    }

    if (local) {
      const profile: PlayerProfile = {
        ...local,
        userId,
      };
      writeLocalProfile(profile);
      void supabase.from("profiles").upsert({
        id: userId,
        display_name: profile.displayName,
        avatar_key: profile.avatarKey,
      });
      return { profile, mode: "supabase" };
    }

    return { profile: null, mode: "supabase" };
  } catch (e) {
    console.warn("bootstrapProfile düştü, yerel moda geçiliyor:", e);
    return { profile: local, mode: "local" };
  }
}

export async function saveProfile(input: {
  displayName: string;
  avatarKey: string;
}): Promise<PlayerProfile> {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) {
    throw new Error("İsim en az 2 karakter olmalı.");
  }
  if (!isAvatarId(input.avatarKey)) {
    throw new Error("Geçersiz avatar.");
  }

  if (!isSupabaseConfigured()) {
    const existing = readLocalProfile();
    const profile: PlayerProfile = {
      userId: existing?.userId ?? localUserId(),
      displayName,
      avatarKey: input.avatarKey,
    };
    writeLocalProfile(profile);
    return profile;
  }

  try {
    const supabase = createClient();
    const sessionResult = await withTimeout(
      supabase.auth.getSession(),
      8000,
      "getSession",
    );
    let userId = sessionResult.data.session?.user?.id;

    if (!userId) {
      const anon = await withTimeout(
        supabase.auth.signInAnonymously(),
        10000,
        "signInAnonymously",
      );
      if (anon.error || !anon.data.user) {
        throw new Error("Oturum açılamadı. Tekrar dene.");
      }
      userId = anon.data.user.id;
    }

    const { error } = await withTimeout(
      supabase.from("profiles").upsert({
        id: userId,
        display_name: displayName,
        avatar_key: input.avatarKey,
      }),
      8000,
      "profiles.upsert",
    );

    if (error) {
      console.warn("Profil sunucuya yazılamadı:", error.message);
    }

    const profile: PlayerProfile = {
      userId,
      displayName,
      avatarKey: input.avatarKey,
    };
    writeLocalProfile(profile);
    return profile;
  } catch (e) {
    // Ağ koptuysa bile yerelde kaydet — oda için Supabase auth gerekir ama
    // en azından UI kilitlenmesin.
    const existing = readLocalProfile();
    const profile: PlayerProfile = {
      userId: existing?.userId ?? localUserId(),
      displayName,
      avatarKey: input.avatarKey,
    };
    writeLocalProfile(profile);
    throw e instanceof Error ? e : new Error("Profil kaydedilemedi");
  }
}
