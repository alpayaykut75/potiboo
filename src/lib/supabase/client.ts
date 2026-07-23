import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "./config";

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase yapılandırılmamış. .env.local dosyasını doldur.",
    );
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
