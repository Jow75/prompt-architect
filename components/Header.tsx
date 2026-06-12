import React from 'react';
import { SparklesIcon } from './icons';

interface HeaderProps {
    email?: string;
    onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ email, onSignOut }) => {
    return (
        <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/70 backdrop-blur-xl">
            <div className="container mx-auto flex items-center gap-3 px-4 py-4 lg:px-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-900/40">
                    <SparklesIcon />
                </div>
                <div className="flex flex-col leading-tight">
                    <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
                        Prompt Architect
                    </h1>
                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                        AI Image Prompt Builder
                    </span>
                </div>
                {(email || onSignOut) && (
                    <div className="ml-auto flex items-center gap-3">
                        {email && <span className="hidden text-xs text-slate-400 sm:inline">{email}</span>}
                        {onSignOut && (
                            <button
                                type="button"
                                onClick={onSignOut}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                            >
                                Sign out
                            </button>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
};
