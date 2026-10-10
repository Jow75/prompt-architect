import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";

// Abuse protection for the /api/* endpoints: a per-IP hourly cap and a per-user
// daily quota, both stored in Netlify Blobs.
//
// Netlify Blobs has no atomic increment, and its conditional writes
// (onlyIfMatch / onlyIfNew) were measured letting several parallel writers
// through. So instead of a shared counter, each request writes its OWN marker
// entry and then counts the markers for the current window. A request that sees
// more markers than the limit removes its own and is refused. Two parallel
// requests can both back off, but they can never both slip past the limit.

export interface AccessResult {
  ok: boolean;
  status?: number;
  message?: string;
}

export interface QuotaReservation extends AccessResult {
  /** Gives the reserved unit back (used when generation fails). Safe to call once. */
  release: () => Promise<void>;
}

/** Minimal marker storage, so the limit logic can be tested without Netlify. */
export interface MarkerStore {
  add(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Keys starting with `prefix`; must reflect every write that has completed. */
  list(prefix: string): Promise<string[]>;
}

function blobMarkerStore(name: string): MarkerStore {
  const store = getStore({ name, consistency: "strong" });
  return {
    add: async (key) => {
      await store.set(key, "1");
    },
    remove: (key) => store.delete(key),
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
  };
}

const MAX_CLAIM_ATTEMPTS = 4;
// Markers from earlier windows removed per request, so storage does not grow forever.
const MAX_STALE_CLEANUP = 40;

/**
 * Claims one unit in the window `scope + window`. Returns the marker key on
 * success, "limit" when the window is full, or "contended" when parallel
 * requests kept colliding at the edge of the limit.
 */
export async function claimSlot(
  store: MarkerStore,
  scope: string,
  window: string,
  limit: number
): Promise<{ key: string } | "limit" | "contended"> {
  const windowPrefix = `${scope}:${window}:`;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const key = `${windowPrefix}${randomUUID()}`;
    await store.add(key);

    const all = await store.list(`${scope}:`);
    const current = all.filter((k) => k.startsWith(windowPrefix));
    const stale = all.filter((k) => !k.startsWith(windowPrefix)).slice(0, MAX_STALE_CLEANUP);
    if (stale.length > 0) {
      await Promise.allSettled(stale.map((k) => store.remove(k)));
    }

    if (current.length <= limit) return { key };

    // Over the limit: back out, give any colliding requests time to back out
    // too, then look again. If the window is still full, the limit is real.
    await store.remove(key);
    await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 250 * (attempt + 1)));
    if ((await store.list(windowPrefix)).length >= limit) return "limit";
  }
  return "contended";
}

const BUSY: AccessResult = { ok: false, status: 429, message: "Too many simultaneous requests. Please try again in a moment." };

// Per-IP, per-hour request cap. Fails OPEN (never blocks real users) if the
// store itself is unavailable.
export async function checkRateLimit(
  ip: string | undefined,
  namespace: string,
  limit: number,
  store?: MarkerStore
): Promise<AccessResult> {
  if (!ip) return { ok: true };
  try {
    const bucket = String(Math.floor(Date.now() / 3_600_000)); // hourly window
    const outcome = await claimSlot(store ?? blobMarkerStore("ratelimit"), `${namespace}:${ip}`, bucket, limit);
    if (outcome === "limit") {
      return { ok: false, status: 429, message: "You've hit the hourly limit for this tool. Please try again later." };
    }
    return outcome === "contended" ? BUSY : { ok: true };
  } catch (err: any) {
    console.warn("[Access] Rate-limit store unavailable; allowing request:", err?.message);
    return { ok: true };
  }
}

// Per-USER daily quota keyed by Supabase user id. Resets at UTC midnight. Fails
// OPEN if the store is unavailable. The caller releases the unit when the
// request produced nothing, so failures do not eat into the quota.
export async function reserveDailyQuota(
  userId: string | undefined,
  namespace: string,
  limit: number,
  store?: MarkerStore
): Promise<QuotaReservation> {
  const noop = async () => {};
  if (!userId) return { ok: true, release: noop };
  try {
    const markers = store ?? blobMarkerStore("quota");
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const outcome = await claimSlot(markers, `${namespace}:${userId}`, day, limit);
    if (outcome === "limit") {
      return {
        ok: false,
        status: 429,
        message: `You've reached today's limit of ${limit}. Your daily quota will reset at midnight UTC.`,
        release: noop,
      };
    }
    if (outcome === "contended") return { ...BUSY, release: noop };

    let released = false;
    return {
      ok: true,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await markers.remove(outcome.key);
        } catch (err: any) {
          console.warn("[Access] Could not release quota unit:", err?.message);
        }
      },
    };
  } catch (err: any) {
    console.warn("[Access] Quota store unavailable; allowing request:", err?.message);
    return { ok: true, release: noop };
  }
}

const CANONICAL_HOST = "si-prompt-architect.netlify.app";
// Deploy previews and branch deploys of this site only: "<name>--si-prompt-architect.netlify.app".
const PREVIEW_HOST = /^[a-z0-9-]+--si-prompt-architect\.netlify\.app$/;

// Reject cross-origin browser callers. Requests without an Origin header pass:
// this is not the security boundary, the verified access token is.
export function isAllowedOrigin(req: any): boolean {
  let origin: string | null = null;
  if (typeof req.headers?.get === "function") {
    origin = req.headers.get("origin");
  } else if (req.headers && typeof req.headers === "object") {
    origin = req.headers["origin"] || null;
  }

  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    let siteHost = "";
    try {
      siteHost = process.env.URL ? new URL(process.env.URL).host : "";
    } catch {
      siteHost = "";
    }
    return (
      originHost === CANONICAL_HOST ||
      (siteHost !== "" && originHost === siteHost) ||
      PREVIEW_HOST.test(originHost) ||
      originHost.startsWith("localhost:") ||
      originHost.startsWith("127.0.0.1:")
    );
  } catch {
    return false;
  }
}
