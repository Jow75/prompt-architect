import React, { useState } from 'react';
import { CopyIcon, CheckIcon, ImageIcon } from './icons';

interface ImageDescriptionDisplayProps {
    description: string;
    isLoading: boolean;
    loadingStep?: string;
    error: string | null;
    activeProvider?: string;
    onClear?: () => void;
    onUseForGeneration?: (prompt: string) => void;
}

const LoadingSkeleton: React.FC<{ loadingStep?: string }> = ({ loadingStep }) => (
    <div className="flex animate-pulse flex-col gap-3 py-2">
        <div className="flex items-center gap-2 mb-1">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            <span className="text-xs font-medium text-violet-300">{loadingStep || 'Enhancing prompt...'}</span>
        </div>
        <div className="h-3.5 w-full rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-5/6 rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-full rounded bg-slate-700/70"></div>
        <div className="h-3.5 w-2/3 rounded bg-slate-700/70"></div>
    </div>
);

function extractCleanPrompt(raw: string): string {
    if (!raw) return '';
    // If output follows the PROMPT: / NEGATIVE PROMPT: template
    const match = raw.match(/PROMPT:\s*([\s\S]*?)(?=NEGATIVE PROMPT:|TIPS:|$)/i);
    if (match && match[1]?.trim()) {
        return match[1].trim();
    }
    return raw.trim();
}

export const ImageDescriptionDisplay: React.FC<ImageDescriptionDisplayProps> = ({
    description,
    isLoading,
    loadingStep,
    error,
    activeProvider,
    onClear,
    onUseForGeneration,
}) => {
    const [copied, setCopied] = useState(false);
    const cleanPrompt = extractCleanPrompt(description);

    const handleCopy = () => {
        navigator.clipboard.writeText(cleanPrompt || description);
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
                        <>
                            {onUseForGeneration && (
                                <button
                                    onClick={() => onUseForGeneration(cleanPrompt)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/20 px-2.5 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/30"
                                    title="Generate image directly with this enhanced prompt"
                                >
                                    <ImageIcon />
                                    <span>Generate This</span>
                                </button>
                            )}
                            <button
                                onClick={handleCopy}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                                aria-label="Copy enhanced prompt"
                            >
                                {copied ? <CheckIcon /> : <CopyIcon />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </>
                    )}
                    {(description || error) && !isLoading && onClear && (
                        <button
                            onClick={onClear}
                            className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                            aria-label="Clear enhanced prompt"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>
            <div className="min-h-[110px] rounded-xl border border-white/5 bg-slate-950/70 p-4 text-sm leading-relaxed text-slate-200">
                {isLoading && <LoadingSkeleton loadingStep={loadingStep} />}
                {error && <p className="text-rose-400">{error}</p>}
                {!isLoading && !error && description && <p className="whitespace-pre-wrap">{description}</p>}
                {!isLoading && !error && !description && (
                    <p className="text-slate-500">
                        Click <span className="font-medium text-slate-400">Enhance with AI</span> to expand your fields into a richer,
                        more detailed prompt you can copy anywhere or generate with FLUX.
                    </p>
                )}
            </div>
        </div>
    );
};
