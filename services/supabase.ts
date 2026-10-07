import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Public Supabase URL + anon key — safe to ship in the client bundle.
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const rawUrl = (env.VITE_SUPABASE_URL ?? '').trim();
const rawKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();

function isValidHttpUrl(u: string): boolean {
    if (!u) return false;
    try {
        const parsed = new URL(u);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !u.includes('placeholder');
    } catch {
        return false;
    }
}

export const isSupabaseConfigured = isValidHttpUrl(rawUrl) && rawKey.length > 0 && !rawKey.includes('placeholder');

// Fallback placeholder credentials so `createClient` doesn't throw a fatal exception
// during module evaluation when environment variables are missing or misconfigured.
const clientUrl = isSupabaseConfigured ? rawUrl : 'https://unconfigured-auth.supabase.co';
const clientKey = isSupabaseConfigured ? rawKey : 'unconfigured-anon-key';

export const supabase: SupabaseClient = createClient(clientUrl, clientKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
    },
});

// Current access token (JWT) for authorizing /api requests, or null if signed out / unconfigured.
export async function getAccessToken(): Promise<string | null> {
    if (!isSupabaseConfigured) return null;
    try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
    } catch (err) {
        console.warn('Failed to retrieve access token:', err);
        return null;
    }
}

