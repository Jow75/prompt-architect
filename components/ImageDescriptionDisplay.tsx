import React, { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';

interface ImageDescriptionDisplayProps {
    description: string;
    isLoading: boolean;
    error: string | null;
    activeProvider?: string;
}

const LoadingSkeleton: React.FC = () => (
    <div className="flex animate-pulse flex-col gap-3">
        <div className="h-3.5 w-full rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-5/6 rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-full rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-2/3 rounded bg-slate-700/70"></div>
    </div>
);

export const ImageDescriptionDisplay: React.FC<ImageDescriptionDisplayProps> = ({ description, isLoading, error, activeProvider }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(description);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    return (
        <div className="flex min-h-[220px] flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">AI-Enhanced Prompt</h2>
                <div className="flex items-center gap-2">
                    {activeProvider && (
                        <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-300">
                            {activeProvider}
                        </span>
                    )}
                    {description && !isLoading && (
                        <button
                            onClick={handleCopy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                            aria-label="Copy enhanced prompt"
                        >
                            {copied ? <CheckIcon /> : <CopyIcon />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    )}
                </div>
            </div>
            <div className="min-h-[110px] rounded-xl border border-white/5 bg-slate-950/70 p-4 text-sm leading-relaxed text-slate-200">
                {isLoading && <LoadingSkeleton />}
                {error && <p className="text-rose-400">{error}</p>}
                {!isLoading && !error && description && <p>{description}</p>}
                {!isLoading && !error && !description && (
                    <p className="text-slate-500">
                        Click <span className="font-medium text-slate-400">Enhance with AI</span> to expand your fields into a richer,
                        more detailed prompt you can copy anywhere.
                    </p>
                )}
            </div>
        </div>
    );
};
