import React, { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';

interface GeneratedPromptDisplayProps {
    prompt: string;
    negativePrompt?: string;
}

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };
    return (
        <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
            aria-label={label}
        >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : label}
        </button>
    );
};

export const GeneratedPromptDisplay: React.FC<GeneratedPromptDisplayProps> = ({ prompt, negativePrompt }) => {
    return (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Your Prompt</h2>
                <CopyButton text={prompt} label="Copy prompt" />
            </div>
            <p className="min-h-[88px] whitespace-pre-wrap break-words rounded-xl border border-white/5 bg-slate-950/70 p-4 font-mono text-sm leading-relaxed text-slate-200">
                {prompt || <span className="text-slate-500">Fill in the fields to build your prompt…</span>}
            </p>

            {negativePrompt && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Negative prompt</span>
                        <CopyButton text={negativePrompt} label="Copy negative" />
                    </div>
                    <p className="whitespace-pre-wrap break-words rounded-xl border border-white/5 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-400">
                        {negativePrompt}
                    </p>
                </div>
            )}
        </div>
    );
};
