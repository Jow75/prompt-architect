import React from 'react';
import { ImagePlaceholderIcon, DownloadIcon } from './icons';

interface GeneratedImageDisplayProps {
    image: string | null;
    isLoading: boolean;
    error: string | null;
    activeProvider?: string;
}

const LoadingSkeleton: React.FC = () => (
    <div className="aspect-square w-full animate-pulse rounded-xl bg-slate-800/80"></div>
);

export const GeneratedImageDisplay: React.FC<GeneratedImageDisplayProps> = ({ image, isLoading, error, activeProvider }) => {
    // Detect format from base64 magic bytes so JPEG (FLUX) and PNG both render.
    const mimeType = image?.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    const imageUrl = image ? `data:${mimeType};base64,${image}` : null;
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';

    return (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Preview Image</h2>
                <div className="flex items-center gap-2">
                    {activeProvider && (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                            {activeProvider}
                        </span>
                    )}
                    {imageUrl && !isLoading && (
                        <a
                            href={imageUrl}
                            download={`prompt-architect.${ext}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                            aria-label="Download image"
                        >
                            <DownloadIcon />
                            Save
                        </a>
                    )}
                </div>
            </div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-slate-950/70 p-3">
                {isLoading && <LoadingSkeleton />}
                {error && !isLoading && (
                    <p className="px-4 text-center text-sm leading-relaxed text-rose-400">{error}</p>
                )}
                {!isLoading && !error && imageUrl && (
                    <img src={imageUrl} alt="Generated preview" className="h-full w-full rounded-lg object-contain" />
                )}
                {!isLoading && !error && !imageUrl && (
                    <div className="flex flex-col items-center gap-3 text-center text-slate-600">
                        <ImagePlaceholderIcon />
                        <p className="max-w-[16rem] text-sm text-slate-500">Generate a preview image from your prompt — powered by NVIDIA FLUX.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
