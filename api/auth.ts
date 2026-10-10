export interface AuthUser {
  id: string;
  email?: string;
}

export type AuthFailureCode =
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "INVALID_TOKEN"
  | "AUTH_UNAVAILABLE"
  | "SERVER_CONFIG_ERROR";

export interface AuthErrorDetails {
  code: AuthFailureCode;
  message: string;
  status: number;
}

export type AuthResult =
  | { success: true; user: AuthUser; error?: undefined }
  | { success: false; error: AuthErrorDetails; user?: undefined };

const fail = (code: AuthFailureCode, status: number, message: string): AuthResult => ({
  success: false,
  error: { code, message, status },
});

const AUTH_UNAVAILABLE = () =>
  fail("AUTH_UNAVAILABLE", 503, "The sign-in service is temporarily unreachable. Please try again in a moment.");

/**
 * Validates the Supabase access token (JWT) from the Bearer Authorization header
 * by asking Supabase Auth (GoTrue) who it belongs to. Only an explicit 401/403
 * from Supabase counts as a bad token; outages and timeouts are reported as 503
 * so a signed-in user is never told to sign in again because Supabase was slow.
 */
export async function verifyAuth(req: any): Promise<AuthResult> {
  if (!req) return fail("AUTH_REQUIRED", 401, "No request context provided.");

  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    // Standard Fetch API Headers (Request.headers.get)
    authHeader = req.headers.get("authorization") || "";
  } else if (req.headers && typeof req.headers === "object") {
    // Node.js / Express headers object
    const raw = req.headers["authorization"] || req.headers["Authorization"];
    authHeader = typeof raw === "string" ? raw : "";
  }

  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return fail("AUTH_REQUIRED", 401, "Authentication required. Please sign in to continue.");

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("placeholder")) {
    console.error("[Auth] Server environment error: Supabase URL or Anon Key is missing or unconfigured.");
    return fail("SERVER_CONFIG_ERROR", 500, "Authentication server is misconfigured. Please verify server environment variables.");
  }

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as any;
      if (data?.id) {
        return { success: true, user: { id: data.id, email: data.email ?? undefined } };
      }
      console.warn("[Auth] Supabase returned 200 without a user id.");
      return AUTH_UNAVAILABLE();
    }

    if (res.status === 401 || res.status === 403) {
      const errJson = (await res.json().catch(() => ({}))) as any;
      const errMsg = String(errJson.msg || errJson.message || errJson.error_description || "");
      if (/\bexpired\b/i.test(errMsg)) {
        return fail("TOKEN_EXPIRED", 401, "Your authentication session has expired. Please refresh your session or sign in again.");
      }
      return fail("INVALID_TOKEN", 401, "Invalid authentication credentials.");
    }

    console.warn(`[Auth] Supabase auth returned HTTP ${res.status}; treating as unavailable.`);
    return AUTH_UNAVAILABLE();
  } catch (err: any) {
    console.warn("[Auth] Could not reach Supabase auth:", err?.message);
    return AUTH_UNAVAILABLE();
  }
}
