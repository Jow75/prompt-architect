import React from 'react';
import { SparklesIcon } from './icons';

export const Header: React.FC = () => {
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
            </div>
        </header>
    );
};
