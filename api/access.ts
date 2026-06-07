import { getStore } from "@netlify/blobs";

// Phase 0 abuse protection for the open /api/* endpoints, so the shared NVIDIA
// key can't be drained by direct/scripted calls. This is a stopgap until real
// auth + per-user quotas land (Supabase).

export interface AccessResult {
  ok: boolean;
  status?: number;
  message?: string;
}

// Per-IP, per-hour request cap using Netlify Blobs (persistent KV). Fails OPEN
// (never blocks real users) if the store is unavailable.
export async function checkRateLimit(ip: string | undefined, namespace: string, limit: number): Promise<AccessResult> {
  if (!ip) return { ok: true };
  try {
    const store = getStore("ratelimit");
    const bucket = Math.floor(Date.now() / 3_600_000); // hourly window
    const key = `${namespace}:${ip}:${bucket}`;
    const current = Number((await store.get(key)) || 0);
    if (current >= limit) {
      return { ok: false, status: 429, message: "You've hit the hourly limit for this tool. Please try again later." };
    }
    await store.set(key, String(current + 1));
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// Reject obvious cross-origin / off-site callers. Same-origin browser requests
// (the SPA) always pass; requests with no Origin are allowed (not hard-blocked).
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const selfHost = new URL(req.url).host;
    return originHost === selfHost || originHost.endsWith(".netlify.app");
  } catch {
    return true;
  }
}
