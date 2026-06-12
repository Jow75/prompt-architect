import { createClient } from "@supabase/supabase-js";

// Validates the Supabase access token (JWT) on the Bearer header and returns the
// authenticated user id, or null if missing/invalid. Used to require login on /api.
export async function requireUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Supabase env vars missing on the server.");
    return null;
  }

  try {
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch (err) {
    console.error("requireUser failed:", err);
    return null;
  }
}
