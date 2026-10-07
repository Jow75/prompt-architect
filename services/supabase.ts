import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';

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

/**
 * Checks whether the user is visibly authenticated (active session exists).
 */
export async function isUserSignedIn(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
        const { data } = await supabase.auth.getSession();
        return Boolean(data.session?.user);
    } catch {
        return false;
    }
}

/**
 * Retrieves a valid Supabase access token (JWT).
 * Proactively verifies token expiration against epoch time.
 * If the token is expired or within 60 seconds of expiring, or if `forceRefresh` is requested,
 * it triggers a legitimate session refresh with Supabase auth.
 * Returns the valid JWT string, or null if no session exists or refresh failed.
 */
export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
    if (!isSupabaseConfigured) return null;

    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
            return null;
        }

        const session: Session = data.session;
        const expiresAtSec = session.expires_at ?? 0;
        const nowSec = Math.floor(Date.now() / 1000);

        // If forced or expires within 60 seconds, refresh session
        const isExpiringSoon = expiresAtSec > 0 && (expiresAtSec - nowSec < 60);

        if (forceRefresh || isExpiringSoon) {
            console.log('[Auth] Access token is expiring or refresh requested; refreshing session...');
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError || !refreshed.session) {
                console.warn('[Auth] Session refresh failed:', refreshError?.message);
                // If expired past expiry, token is invalid
                if (expiresAtSec > 0 && nowSec >= expiresAtSec) {
                    return null;
                }
                // Return current token if still technically unexpired
                return session.access_token || null;
            }
            return refreshed.session.access_token || null;
        }

        return session.access_token || null;
    } catch (err) {
        console.warn('[Auth] Exception while retrieving access token:', err);
        return null;
    }
}

/**
 * Backwards-compatible alias for getValidAccessToken.
 */
export async function getAccessToken(): Promise<string | null> {
    return getValidAccessToken(false);
}
