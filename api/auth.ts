import { createClient } from "@supabase/supabase-js";

// Validates the Supabase access token (JWT) on the Bearer header and returns the
// authenticated user id, or null if missing/invalid. Used to require login on /api.
// Compatible with both standard Fetch API Requests (Netlify Functions) and Express requests (local server).
export async function requireUser(req: any): Promise<{ id: string; email?: string } | null> {
  if (!req) return null;

  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    // Standard Fetch API Headers (Request.headers.get)
    authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  } else if (req.headers && typeof req.headers === "object") {
    // Node.js / Express headers object
    const raw = req.headers["authorization"] || req.headers["Authorization"];
    authHeader = typeof raw === "string" ? raw : "";
  }

  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("placeholder")) {
    console.error("Supabase env vars missing or unconfigured on the server.");
    return null;
  }

  try {
    const supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch (err) {
    console.error("requireUser failed:", err);
    return null;
  }
}

