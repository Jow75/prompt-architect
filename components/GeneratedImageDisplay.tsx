import React from 'react';
import { ImagePlaceholderIcon, DownloadIcon } from './icons';

interface GeneratedImageDisplayProps {
    images: string[];
    count: number;
    isLoading: boolean;
    loadingStep?: string;
    error: string | null;
    activeProvider?: string;
    onDismissError?: () => void;
}

const dataUrl = (b64: string) => {
    if (b64.startsWith('data:image/')) return b64;
    return `data:${b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${b64}`;
};
const ext = (b64: string) => (b64.startsWith('/9j/') ? 'jpg' : 'png');

export const GeneratedImageDisplay: React.FC<GeneratedImageDisplayProps> = ({
    images,
    count,
    isLoading,
    loadingStep,
    error,
    activeProvider,
    onDismissError,
}) => {
    const multi = (isLoading ? count : images.length) > 1;
    const gridClass = multi ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1';

    return (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Preview {images.length > 1 ? 'Images' : 'Image'}</h2>
                <div className="flex items-center gap-2">
                    {activeProvider && (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                            {activeProvider}
                        </span>
                    )}
                    {error && onDismissError && !isLoading && (
                        <button
                            onClick={onDismissError}
                            className="text-xs text-slate-400 hover:text-slate-200 transition"
                        >
                            Dismiss
                        </button>
                    )}
                </div>
            </div>

            {isLoading && (
                <div className="flex flex-col gap-3">
                    <div className={gridClass}>
                        {Array.from({ length: count }).map((_, i) => (
                            <div
                                key={i}
                                className="aspect-square w-full animate-pulse rounded-xl bg-slate-800/80 flex flex-col items-center justify-center p-4 text-center"
                            >
                                <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent mb-2" />
                                <span className="text-xs font-medium text-slate-300">
                                    {loadingStep || 'Generating image...'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {error && !isLoading && (
                <div className="flex aspect-square items-center justify-center rounded-xl border border-rose-500/20 bg-rose-950/20 p-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-rose-400 text-sm font-semibold">Generation Failed</span>
                        <p className="max-w-sm text-xs leading-relaxed text-rose-300/90">{error}</p>
                    </div>
                </div>
            )}

            {!isLoading && !error && images.length > 0 && (
                <div className={gridClass}>
                    {images.map((img, i) => (
                        <div key={i} className="group relative overflow-hidden rounded-xl border border-white/5 bg-slate-950/70">
                            <img src={dataUrl(img)} alt={`Generated preview ${i + 1}`} className="h-full w-full object-contain" />
                            <a
                                href={dataUrl(img)}
                                download={`prompt-architect-${i + 1}.${ext(img)}`}
                                className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                                aria-label="Download image"
                            >
                                <DownloadIcon />
                                Save
                            </a>
                        </div>
                    ))}
                </div>
            )}

            {!isLoading && !error && images.length === 0 && (
                <div className="flex aspect-square items-center justify-center rounded-xl border border-white/5 bg-slate-950/70 p-3">
                    <div className="flex flex-col items-center gap-3 text-center text-slate-600">
                        <ImagePlaceholderIcon />
                        <p className="max-w-[16rem] text-sm text-slate-500">Generate a preview image from your prompt.</p>
                    </div>
                </div>
            )}
        </div>
    );
};
