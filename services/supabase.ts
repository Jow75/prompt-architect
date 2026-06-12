import { createClient } from '@supabase/supabase-js';

// Public Supabase URL + anon key — safe to ship in the client bundle.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL ?? '';
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(url, anonKey);

// Current access token (JWT) for authorizing /api requests, or null if signed out.
export async function getAccessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
}
