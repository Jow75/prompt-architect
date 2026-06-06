import React, { useState, useMemo, useCallback } from 'react';
import { PromptData } from './types';
import { PromptInputSection } from './components/PromptInputSection';
import { GeneratedPromptDisplay } from './components/GeneratedPromptDisplay';
import { ImageDescriptionDisplay } from './components/ImageDescriptionDisplay';
import { GeneratedImageDisplay } from './components/GeneratedImageDisplay';
import { Header } from './components/Header';
import { generateVividDescription, generateImage } from './services/geminiService';
import { GenerateIcon, ImageIcon } from './components/icons';

const fieldClass =
    'w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200 placeholder-slate-500 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

const selectClass =
    'w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 p-2.5 text-sm text-slate-200 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

// Models available via the NVIDIA API key (verified). Selecting one uses exactly that model.
const TEXT_MODELS = [
    { id: 'auto', label: 'Auto (recommended)' },
    { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B (fast)' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (best)' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'qwen/qwen3-next-80b-a3b-instruct', label: 'Qwen3 80B' },
];

const IMAGE_MODELS = [
    { id: 'auto', label: 'Auto (recommended)' },
    { id: 'flux.1-schnell', label: 'FLUX.1 Schnell (fast)' },
    { id: 'flux.1-dev', label: 'FLUX.1 Dev (quality)' },
];

const ASPECT_RATIOS = [
    { id: '1:1', label: 'Square 1:1 (1024×1024)' },
    { id: '16:9', label: 'Landscape 16:9 (1344×768)' },
    { id: '9:16', label: 'Portrait 9:16 (768×1344)' },
    { id: '3:2', label: 'Photo 3:2 (1216×832)' },
    { id: '3:4', label: 'Portrait 3:4 (896×1152)' },
];

// Short labels for the result badges.
const MODEL_BADGE: Record<string, string> = {
    'flux.1-schnell': 'FLUX.1 Schnell',
    'flux.1-dev': 'FLUX.1 Dev',
    'meta/llama-3.1-8b-instruct': 'Llama 3.1 8B',
    'meta/llama-3.3-70b-instruct': 'Llama 3.3 70B',
    'openai/gpt-oss-120b': 'GPT-OSS 120B',
    'qwen/qwen3-next-80b-a3b-instruct': 'Qwen3 80B',
};
const badge = (id: string) => MODEL_BADGE[id] || (id && id !== 'auto' ? id : '');

const EMPTY_PROMPT: PromptData = {
    subject: '', action: '', environment: '', details: '', pose: '',
    expression: '', clothing: '', style: '', lighting: '', camera: '', negativePrompt: '',
};

// Loaded on demand via the "Load example" button so people can see a full sample.
const EXAMPLE_PROMPT: PromptData = {
    subject: 'A young female explorer with freckles and windswept auburn hair',
    action: 'standing at the edge of an ancient stone bridge, gazing over a vast jungle canyon',
    environment: 'lush emerald jungle, a distant thundering waterfall, golden afternoon mist drifting between the cliffs',
    details: 'a weathered leather satchel, a brass compass in one hand, bright determined hazel eyes',
    pose: 'one hand resting on the mossy stone railing, leaning slightly forward, confident and balanced',
    expression: 'curious and adventurous, a faint hopeful smile',
    clothing: 'rugged khaki explorer outfit, rolled-up sleeves, a wide-brim hat, fingerless gloves',
    style: 'cinematic concept art, highly detailed digital painting, painterly realism',
    lighting: 'warm golden-hour backlight with soft volumetric god rays',
    camera: 'wide establishing shot, 35mm lens, sharp focus, rich depth, 8k detail',
    negativePrompt: 'blurry, low quality, distorted, deformed hands, extra limbs, watermark, text, signature, oversaturated',
};

const App: React.FC = () => {
    const [promptData, setPromptData] = useState<PromptData>(EMPTY_PROMPT);

    const [textModel, setTextModel] = useState<string>('auto');
    const [imageModel, setImageModel] = useState<string>('auto');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [activeTextModel, setActiveTextModel] = useState<string>('');
    const [activeImageModel, setActiveImageModel] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [isImageLoading, setIsImageLoading] = useState<boolean>(false);
    const [imageError, setImageError] = useState<string | null>(null);

    const handleInputChange = useCallback((field: keyof PromptData, value: string) => {
        setPromptData(prev => ({ ...prev, [field]: value }));
    }, []);

    const hasContent = useMemo(() => Object.values(promptData).some(v => String(v).trim() !== ''), [promptData]);

    // Clean, comma-separated prompt — usable in any AI image tool.
    const generatedPrompt = useMemo(() => {
        return [
            promptData.subject, promptData.action, promptData.environment, promptData.details,
            promptData.pose, promptData.expression, promptData.clothing,
            promptData.style, promptData.lighting, promptData.camera,
        ]
            .map(p => p && p.trim())
            .filter(Boolean)
            .join(', ');
    }, [promptData]);

    const canGenerate = generatedPrompt.trim().length > 0 && !isLoading && !isImageLoading;

    const handleEnhance = async () => {
        setIsLoading(true);
        setError(null);
        setDescription('');
        setActiveTextModel('');
        try {
            const result = await generateVividDescription(generatedPrompt, textModel);
            setDescription(result.description);
            setActiveTextModel(result.model || textModel);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateImage = async () => {
        setIsImageLoading(true);
        setImageError(null);
        setGeneratedImage(null);
        setActiveImageModel('');
        try {
            const { image, model } = await generateImage(generatedPrompt, imageModel, aspectRatio);
            setGeneratedImage(image);
            setActiveImageModel(model || imageModel);
        } catch (err) {
            setImageError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsImageLoading(false);
        }
    };

    const field = (key: keyof PromptData, placeholder: string, rows = 2) => (
        <textarea
            value={promptData[key]}
            onChange={(e) => handleInputChange(key, e.target.value)}
            placeholder={placeholder}
            rows={rows}
            className={fieldClass}
        />
    );

    const input = (key: keyof PromptData, placeholder: string) => (
        <input
            type="text"
            value={promptData[key]}
            onChange={(e) => handleInputChange(key, e.target.value)}
            placeholder={placeholder}
            className={fieldClass}
        />
    );

    return (
        <div className="min-h-screen font-sans text-slate-200">
            <Header />
            <main className="container mx-auto px-4 py-8 lg:px-8">
                <div className="mb-8 max-w-2xl">
                    <h2 className="text-2xl font-bold text-white sm:text-3xl">Build a perfect image prompt</h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                        Fill in the fields below — each one shows an example of what to write. Prompt Architect assembles a clean,
                        copy-ready prompt as you type. Then enhance it with AI, generate a preview image, and use it anywhere.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                    {/* Left: builder */}
                    <div className="flex flex-col gap-7 rounded-2xl border border-white/10 bg-slate-900/40 p-6 shadow-xl shadow-black/20">
                        <div className="flex items-center justify-between border-b border-white/5 pb-4">
                            <h3 className="text-base font-semibold text-white">Prompt builder</h3>
                            <button
                                onClick={() => setPromptData(hasContent ? EMPTY_PROMPT : EXAMPLE_PROMPT)}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                            >
                                {hasContent ? 'Clear all' : 'Load example'}
                            </button>
                        </div>

                        <PromptInputSection title="Core Scene">
                            {field('subject', 'Who or what is the focus?  e.g. a young female explorer with auburn hair')}
                            {field('action', 'What is happening?  e.g. standing at the edge of a stone bridge, gazing over a canyon')}
                            {field('environment', 'Where is it set?  e.g. lush jungle canyon, distant waterfall, golden mist')}
                        </PromptInputSection>

                        <PromptInputSection title="Subject Details">
                            {input('pose', 'Pose  ·  e.g. one hand on the railing, leaning forward, confident')}
                            {input('expression', 'Expression / mood  ·  e.g. curious, a faint hopeful smile')}
                            {input('clothing', 'Clothing / attire  ·  e.g. rugged khaki outfit, wide-brim hat, gloves')}
                            {field('details', 'Extra details & props  ·  e.g. a brass compass, a leather satchel, freckles')}
                        </PromptInputSection>

                        <PromptInputSection title="Style & Camera">
                            {field('style', 'Art style  ·  e.g. cinematic concept art, photorealistic, anime, oil painting')}
                            {field('lighting', 'Lighting  ·  e.g. golden-hour backlight, soft god rays, neon glow')}
                            {field('camera', 'Camera & quality  ·  e.g. wide shot, 35mm lens, sharp focus, 8k detail')}
                        </PromptInputSection>

                        <PromptInputSection title="Negative Prompt">
                            {field('negativePrompt', 'Things to avoid  ·  e.g. blurry, watermark, extra limbs, text, low quality')}
                        </PromptInputSection>

                        <PromptInputSection title="Model">
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-slate-500">Enhance model</label>
                                    <select value={textModel} onChange={(e) => setTextModel(e.target.value)} className={selectClass}>
                                        {TEXT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-slate-500">Image model</label>
                                    <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className={selectClass}>
                                        {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-slate-500">Aspect ratio</label>
                                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className={selectClass}>
                                        {ASPECT_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                                    </select>
                                </div>
                                <p className="rounded-lg border border-white/5 bg-slate-950/50 p-2.5 text-[11px] leading-relaxed text-slate-500">
                                    Whatever model you pick is the exact one used. <span className="text-slate-400">Auto</span> picks a fast,
                                    reliable default for you.
                                </p>
                            </div>
                        </PromptInputSection>
                    </div>

                    {/* Right: outputs */}
                    <div className="flex flex-col gap-6">
                        <GeneratedPromptDisplay prompt={generatedPrompt} negativePrompt={promptData.negativePrompt} />

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <button
                                onClick={handleEnhance}
                                disabled={!canGenerate}
                                className="flex items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <GenerateIcon />
                                {isLoading ? 'Enhancing…' : 'Enhance with AI'}
                            </button>
                            <button
                                onClick={handleGenerateImage}
                                disabled={!canGenerate}
                                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <ImageIcon />
                                {isImageLoading ? 'Generating…' : 'Generate Image'}
                            </button>
                        </div>

                        <ImageDescriptionDisplay
                            description={description}
                            isLoading={isLoading}
                            error={error}
                            activeProvider={badge(activeTextModel)}
                            onClear={() => { setDescription(''); setError(null); setActiveTextModel(''); }}
                        />
                        <GeneratedImageDisplay
                            image={generatedImage}
                            isLoading={isImageLoading}
                            error={imageError}
                            activeProvider={badge(activeImageModel)}
                        />
                    </div>
                </div>

                <footer className="mt-12 border-t border-white/5 pt-6 text-center text-xs text-slate-600">
                    Prompt Architect · Build, enhance & preview AI image prompts
                </footer>
            </main>
        </div>
    );
};

export default App;
