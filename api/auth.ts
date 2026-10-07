import { createClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email?: string;
}

export type AuthFailureCode =
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "INVALID_TOKEN"
  | "SERVER_CONFIG_ERROR";

export interface AuthErrorDetails {
  code: AuthFailureCode;
  message: string;
  status: number;
}

export type AuthResult =
  | { success: true; user: AuthUser; error?: undefined }
  | { success: false; error: AuthErrorDetails; user?: undefined };

/**
 * Validates the Supabase access token (JWT) from the Bearer Authorization header.
 * Uses direct GoTrue REST verification with fallback to @supabase/supabase-js client,
 * ensuring 100% reliability across serverless runtimes (Netlify Functions, Express, Edge).
 */
export async function verifyAuth(req: any): Promise<AuthResult> {
  if (!req) {
    return {
      success: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "No request context provided.",
        status: 401,
      },
    };
  }

  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    // Standard Fetch API Headers (Request.headers.get)
    authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  } else if (req.headers && typeof req.headers === "object") {
    // Node.js / Express headers object
    const raw = req.headers["authorization"] || req.headers["Authorization"];
    authHeader = typeof raw === "string" ? raw : "";
  }

  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return {
      success: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required. Please sign in to continue.",
        status: 401,
      },
    };
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("placeholder")) {
    console.error("[Auth] Server environment error: Supabase URL or Anon Key is missing or unconfigured.");
    return {
      success: false,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: "Authentication server is misconfigured. Please verify server environment variables.",
        status: 500,
      },
    };
  }

  // 1. Primary Strategy: Direct GoTrue REST verification (zero dependency quirks in serverless)
  try {
    const userEndpoint = `${url.replace(/\/+$/, "")}/auth/v1/user`;
    const res = await fetch(userEndpoint, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      if (data && data.id) {
        return {
          success: true,
          user: {
            id: data.id,
            email: data.email ?? undefined,
          },
        };
      }
    }

    if (res.status === 401 || res.status === 403) {
      const errJson = (await res.json().catch(() => ({}))) as any;
      const errMsg = errJson.msg || errJson.message || errJson.error_description || "Invalid token";
      const isExpired = errMsg.toLowerCase().includes("expired") || errMsg.toLowerCase().includes("exp");

      return {
        success: false,
        error: {
          code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
          message: isExpired
            ? "Your authentication session has expired. Please refresh your session or sign in again."
            : "Invalid authentication credentials.",
          status: 401,
        },
      };
    }
  } catch (directErr: any) {
    console.warn("[Auth] Direct GoTrue REST validation encountered an issue; attempting client fallback:", directErr.message);
  }

  // 2. Secondary Strategy: Supabase JS SDK client
  try {
    const supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      const errMsg = error?.message || "Invalid token";
      const isExpired = errMsg.toLowerCase().includes("expired") || errMsg.toLowerCase().includes("exp");

      return {
        success: false,
        error: {
          code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
          message: isExpired
            ? "Your authentication session has expired. Please refresh your session or sign in again."
            : "Invalid authentication credentials.",
          status: 401,
        },
      };
    }

    return {
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email ?? undefined,
      },
    };
  } catch (err: any) {
    console.error("[Auth] Both direct and client token validation failed:", err);
    return {
      success: false,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: `Failed to verify session token: ${err?.message || String(err)}`,
        status: 500,
      },
    };
  }
}

/**
 * Backwards-compatible helper returning User object or null.
 */
export async function requireUser(req: any): Promise<AuthUser | null> {
  const result = await verifyAuth(req);
  return result.success ? result.user : null;
}
