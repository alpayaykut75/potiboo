/**
 * Telefonda localhost çalışmaz. Geliştirmede LAN IP kullan.
 * .env.local → NEXT_PUBLIC_LAN_HOST=192.168.x.x
 */
export function buildJoinUrl(pin: string, currentOrigin?: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (currentOrigin ?? "http://localhost:3000");

  const lanHost = process.env.NEXT_PUBLIC_LAN_HOST?.trim();
  let base = origin;

  try {
    const url = new URL(origin);
    const isLocal =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocal && lanHost) {
      const host = lanHost.includes(":") ? lanHost : `${lanHost}:${url.port || "3000"}`;
      base = `${url.protocol}//${host}`;
    }
  } catch {
    // origin parse edilemezse olduğu gibi kullan
  }

  return `${base.replace(/\/$/, "")}/join/${pin}`;
}
