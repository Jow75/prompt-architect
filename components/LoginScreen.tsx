import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { SparklesIcon } from './icons';

export const LoginScreen: React.FC = () => {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const inputClass =
        'w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200 placeholder-slate-500 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

    const handleEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setNotice(null);
        try {
            if (mode === 'signup') {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setNotice('Account created. If email confirmation is on, check your inbox — otherwise you can sign in now.');
                setMode('signin');
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                // On success, the auth listener in App swaps to the app automatically.
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = async () => {
        setError(null);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin },
        });
        if (error) setError(error.message);
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
                            {mode === 'signin' ? 'Sign in to start building prompts' : 'Create your free account'}
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleGoogle}
                    className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
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

                <form onSubmit={handleEmail} className="flex flex-col gap-3">
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={inputClass} autoComplete="email" />
                    <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputClass} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={6} />
                    {error && <p className="text-sm text-rose-400">{error}</p>}
                    {notice && <p className="text-sm text-emerald-400">{notice}</p>}
                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-1 flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                    >
                        {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                </form>

                <p className="mt-5 text-center text-sm text-slate-400">
                    {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
                    <button
                        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}
                        className="font-medium text-violet-300 hover:text-violet-200"
                    >
                        {mode === 'signin' ? 'Sign up' : 'Sign in'}
                    </button>
                </p>
            </div>
        </div>
    );
};
