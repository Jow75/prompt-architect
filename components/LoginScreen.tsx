import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { SparklesIcon } from './icons';

export interface LoginScreenProps {
    initialMode?: 'signin' | 'signup' | 'forgot-password' | 'update-password';
    onPasswordUpdated?: () => void;
    initialError?: string | null;
}

function sanitizeAuthError(err: unknown): string {
    if (!err) return 'An error occurred during authentication.';
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();

    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('enotfound')) {
        return 'Unable to reach the authentication service. Please check your connection or verify server status.';
    }
    if (lower.includes('invalid login credentials')) {
        return 'Incorrect email or password. Please check your credentials and try again.';
    }
    if (lower.includes('email not confirmed')) {
        return 'Your email has not been verified yet. Please check your inbox for the confirmation link.';
    }
    if (lower.includes('user already registered')) {
        return 'An account with this email already exists. Please sign in or reset your password.';
    }
    if (lower.includes('password should be at least 6 characters')) {
        return 'Password must be at least 6 characters long.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
        return 'Too many attempts. Please wait a few moments and try again.';
    }
    return msg;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
    initialMode = 'signin',
    onPasswordUpdated,
    initialError = null,
}) => {
    const [mode, setMode] = useState<'signin' | 'signup' | 'forgot-password' | 'check-email' | 'update-password'>(initialMode);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(initialError);
    const [notice, setNotice] = useState<string | null>(null);

    const inputClass =
        'w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200 placeholder-slate-500 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

    const handleEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setNotice(null);

        if (!isSupabaseConfigured) {
            setError('Authentication service is not configured. Please verify environment settings.');
            setLoading(false);
            return;
        }

        try {
            if (mode === 'signup') {
                if (password !== confirmPassword) {
                    throw new Error('Passwords do not match. Please re-enter.');
                }
                if (password.length < 6) {
                    throw new Error('Password must be at least 6 characters long.');
                }

                const { data, error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: window.location.origin,
                    },
                });

                if (signUpError) throw signUpError;

                // Handle email enumeration protection: user already exists if identities array is empty
                if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                    setError('An account with this email already exists. Please sign in instead.');
                    return;
                }

                // If session is immediately returned, auth listener in App will swap view
                if (data.session) {
                    return;
                }

                // If no active session, confirmation email was sent
                setMode('check-email');
                setNotice(`We sent a verification link to ${email}. Please check your inbox to activate your account.`);
            } else if (mode === 'signin') {
                const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
                if (signInError) throw signInError;
                // On success, the auth listener in App swaps to the app automatically.
            } else if (mode === 'forgot-password') {
                const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/`,
                });
                if (resetError) throw resetError;
                setNotice(`If an account exists for ${email}, a password reset link has been sent. Check your inbox.`);
            } else if (mode === 'update-password') {
                if (password !== confirmPassword) {
                    throw new Error('Passwords do not match. Please re-enter.');
                }
                if (password.length < 6) {
                    throw new Error('Password must be at least 6 characters long.');
                }
                const { error: updateError } = await supabase.auth.updateUser({ password });
                if (updateError) throw updateError;
                setNotice('Your password has been successfully updated.');
                if (onPasswordUpdated) {
                    onPasswordUpdated();
                } else {
                    setMode('signin');
                }
            }
        } catch (err) {
            setError(sanitizeAuthError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleResendVerification = async () => {
        if (!email) {
            setError('Please provide your email address.');
            return;
        }
        setLoading(true);
        setError(null);
        setNotice(null);
        try {
            const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email,
                options: {
                    emailRedirectTo: window.location.origin,
                },
            });
            if (resendError) throw resendError;
            setNotice(`Verification email resent to ${email}. Please check your inbox.`);
        } catch (err) {
            setError(sanitizeAuthError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = async () => {
        setError(null);
        if (!isSupabaseConfigured) {
            setError('Google sign-in is not configured yet.');
            return;
        }
        try {
            const { error: oAuthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin },
            });
            if (oAuthError) setError(sanitizeAuthError(oAuthError));
        } catch (err) {
            setError(sanitizeAuthError(err));
        }
    };

    const subtitleMap: Record<string, string> = {
        'signin': 'Sign in to start building prompts',
        'signup': 'Create your free account',
        'forgot-password': 'Reset your password',
        'check-email': 'Verify your email address',
        'update-password': 'Enter your new password',
    };

    return (
        <div className="flex min-h-screen items-center justify-center px-4 py-12">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/60 p-7 shadow-2xl shadow-black/40">
                <div className="mb-6 flex flex-col items-center gap-3 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-900/40">
                        <SparklesIcon />
                    </div>
                    <div>
                        <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-xl font-bold text-transparent">
                            Prompt Architect
                        </h1>
                        <p className="mt-1 text-sm text-slate-400">
                            {subtitleMap[mode] || 'AI Image Prompt Builder'}
                        </p>
                    </div>
                </div>

                {!isSupabaseConfigured && (
                    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                        Authentication service configuration required. Please set up your Supabase project credentials.
                    </div>
                )}

                {(mode === 'signin' || mode === 'signup') && (
                    <>
                        <button
                            type="button"
                            onClick={handleGoogle}
                            className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                        >
                            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                                <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
                                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                                <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z" />
                                <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.4 36.9 44 31 44 24c0-1.3-.1-2.3-.4-3.5z" />
                            </svg>
                            Continue with Google
                        </button>

                        <div className="mb-4 flex items-center gap-3 text-xs text-slate-600">
                            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
                        </div>
                    </>
                )}

                {mode === 'check-email' ? (
                    <div className="flex flex-col gap-4 text-center">
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs leading-relaxed text-emerald-300">
                            {notice || `We sent a confirmation link to ${email}. Please check your inbox and confirm your email to sign in.`}
                        </div>
                        {error && <p className="text-xs text-rose-400">{error}</p>}
                        <button
                            type="button"
                            onClick={handleResendVerification}
                            disabled={loading}
                            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                        >
                            {loading ? 'Sending…' : 'Resend verification email'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
                            className="text-xs font-medium text-violet-300 hover:text-violet-200"
                        >
                            Back to sign in
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleEmail} className="flex flex-col gap-3">
                        {mode !== 'update-password' && (
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email"
                                className={inputClass}
                                autoComplete="email"
                            />
                        )}

                        {mode !== 'forgot-password' && (
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={mode === 'update-password' ? 'New password (min. 6 characters)' : 'Password'}
                                className={inputClass}
                                autoComplete={mode === 'signup' || mode === 'update-password' ? 'new-password' : 'current-password'}
                                minLength={6}
                            />
                        )}

                        {(mode === 'signup' || mode === 'update-password') && (
                            <input
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm password"
                                className={inputClass}
                                autoComplete="new-password"
                                minLength={6}
                            />
                        )}

                        {error && <p className="text-xs leading-relaxed text-rose-400">{error}</p>}
                        {notice && <p className="text-xs leading-relaxed text-emerald-400">{notice}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-1 flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                        >
                            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot-password' ? 'Send reset link' : 'Update password'}
                        </button>

                        {mode === 'signin' && (
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => { setMode('forgot-password'); setError(null); setNotice(null); }}
                                    className="text-xs text-slate-400 hover:text-violet-300 transition"
                                >
                                    Forgot password?
                                </button>
                            </div>
                        )}

                        {mode === 'forgot-password' && (
                            <div className="text-center mt-2">
                                <button
                                    type="button"
                                    onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
                                    className="text-xs font-medium text-violet-300 hover:text-violet-200"
                                >
                                    Back to sign in
                                </button>
                            </div>
                        )}
                    </form>
                )}

                {(mode === 'signin' || mode === 'signup') && (
                    <p className="mt-5 text-center text-sm text-slate-400">
                        {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
                        <button
                            type="button"
                            onClick={() => {
                                setMode(mode === 'signin' ? 'signup' : 'signin');
                                setError(null);
                                setNotice(null);
                                setPassword('');
                                setConfirmPassword('');
                            }}
                            className="font-medium text-violet-300 hover:text-violet-200"
                        >
                            {mode === 'signin' ? 'Sign up' : 'Sign in'}
                        </button>
                    </p>
                )}
            </div>
        </div>
    );
};

