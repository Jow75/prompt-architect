import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { PromptData } from './types';
import { PromptInputSection } from './components/PromptInputSection';
import { GeneratedPromptDisplay } from './components/GeneratedPromptDisplay';
import { ImageDescriptionDisplay } from './components/ImageDescriptionDisplay';
import { GeneratedImageDisplay } from './components/GeneratedImageDisplay';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { SuggestionChips } from './components/SuggestionChips';
import { supabase } from './services/supabase';
import { generateVividDescription, generateImage } from './services/geminiService';
import { formatUserFacingError, AuthRequiredError, TokenExpiredError } from './services/errors';
import { GenerateIcon, ImageIcon } from './components/icons';

// Common, click-to-add keyword suggestions for the relevant fields.
const STYLE_OPTIONS = ['photorealistic', 'cinematic concept art', 'anime', 'oil painting', 'watercolor', '3D render', 'digital painting', 'pixel art', 'comic book style', 'pencil sketch'];
const LIGHTING_OPTIONS = ['golden hour', 'soft natural light', 'volumetric god rays', 'neon glow', 'studio lighting', 'rim light', 'dramatic shadows', 'cinematic lighting', 'backlight'];
const CAMERA_OPTIONS = ['8k', 'ultra detailed', 'sharp focus', '35mm lens', '85mm portrait', 'shallow depth of field', 'wide angle', 'bokeh', 'DSLR photo'];
const DETAIL_OPTIONS = ['detailed face', 'expressive eyes', 'natural skin texture', 'intricate details', 'flowing hair', 'subtle freckles'];
const NEGATIVE_OPTIONS = ['blurry', 'low quality', 'watermark', 'text', 'signature', 'deformed hands', 'extra limbs', 'distorted', 'oversaturated', 'bad anatomy', 'cropped', 'jpeg artifacts'];

const fieldClass =
    'w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200 placeholder-slate-500 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

const selectClass =
    'w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 p-2.5 text-sm text-slate-200 transition focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

// Models the server accepts (see api/handlers.ts and api/providers/nvidia.ts).
// Timings were measured on this NVIDIA account.
const TEXT_MODELS = [
    { id: 'auto', label: 'Auto (Recommended - Nemotron 3 Super)' },
    { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'NVIDIA Nemotron 3 Super (Fast ~3s)' },
    { id: 'openai/gpt-oss-20b', label: 'NVIDIA GPT-OSS 20B (~10-15s)' },
    { id: 'meta/llama-3.2-11b-vision-instruct', label: 'NVIDIA Llama 3.2 11B (Slow, may time out)' },
];

const IMAGE_MODELS = [
    { id: 'auto', label: 'Auto (Recommended - FLUX.2 Klein 4B)' },
    { id: 'flux.2-klein-4b', label: 'NVIDIA FLUX.2 Klein 4B (Fast ~3s)' },
    { id: 'flux.1-dev', label: 'NVIDIA FLUX.1 Dev (Quality, slow - may time out)' },
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
    'flux.2-klein-4b': 'FLUX.2 Klein',
    'flux.1-dev': 'FLUX.1 Dev',
    'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super',
    'openai/gpt-oss-20b': 'GPT-OSS 20B',
    'meta/llama-3.2-11b-vision-instruct': 'Llama 3.2 11B',
};
const badge = (id: string) => MODEL_BADGE[id] || (id && id !== 'auto' ? id : '');

const EMPTY_PROMPT: PromptData = {
    subject: '', action: '', environment: '', details: '', pose: '',
    expression: '', clothing: '', style: '', lighting: '', camera: '', negativePrompt: '',
};

// Full sample prompt
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
    const [session, setSession] = useState<Session | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'forgot-password' | 'update-password'>('signin');
    const [authError, setAuthError] = useState<string | null>(null);

    // Concurrency guard to prevent double-clicks & race conditions
    const isGeneratingRef = useRef(false);

    useEffect(() => {
        // Parse URL hash / query parameters for password recovery or OAuth error feedback
        const hash = window.location.hash || '';
        const search = window.location.search || '';
        const combined = hash.startsWith('#') ? hash.slice(1) : search.startsWith('?') ? search.slice(1) : '';
        const params = new URLSearchParams(combined);

        if (hash.includes('type=recovery') || search.includes('type=recovery')) {
            setAuthMode('update-password');
        }

        const errDesc = params.get('error_description');
        if (errDesc) {
            setAuthError(decodeURIComponent(errDesc.replace(/\+/g, ' ')));
        }

        // Initialize session safely without unhandled promise rejections
        supabase.auth.getSession()
            .then(({ data }) => {
                setSession(data?.session ?? null);
            })
            .catch((err) => {
                console.warn('Initial session check failed:', err);
                setSession(null);
            })
            .finally(() => {
                setAuthReady(true);
            });

        const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
            setSession(s);
            if (event === 'PASSWORD_RECOVERY') {
                setAuthMode('update-password');
            }
        });

        return () => sub.subscription.unsubscribe();
    }, []);

    const [promptData, setPromptData] = useState<PromptData>(EMPTY_PROMPT);

    const [textModel, setTextModel] = useState<string>('auto');
    const [imageModel, setImageModel] = useState<string>('auto');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');

    const [activeTextModel, setActiveTextModel] = useState<string>('');
    const [activeImageModel, setActiveImageModel] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [descriptionTask, setDescriptionTask] = useState<'generate' | 'edit'>('generate');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [textLoadingStep, setTextLoadingStep] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const [numImages, setNumImages] = useState<number>(1);
    const [generatedImages, setGeneratedImages] = useState<string[]>([]);
    const [isImageLoading, setIsImageLoading] = useState<boolean>(false);
    const [imageLoadingStep, setImageLoadingStep] = useState<string>('');
    const [imageError, setImageError] = useState<string | null>(null);

    const [editImage, setEditImage] = useState<string | null>(null);
    const [editInstruction, setEditInstruction] = useState<string>('');

    // Shows a failed request's message. When the server no longer accepts the
    // session, drop it locally so the login screen appears instead of leaving a
    // "please sign in" error inside the signed-in view.
    const reportRequestError = (err: unknown, setMessage: (message: string) => void) => {
        const formatted = formatUserFacingError(err);
        setMessage(formatted);
        if (err instanceof AuthRequiredError || err instanceof TokenExpiredError) {
            setAuthError(formatted);
            setAuthMode('signin');
            supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        }
    };

    const handleInputChange = useCallback((field: keyof PromptData, value: string) => {
        setPromptData(prev => ({ ...prev, [field]: value }));
    }, []);

    const hasContent = useMemo(() => Object.values(promptData).some(v => String(v).trim() !== ''), [promptData]);

    // Clean, comma-separated prompt assembled from individual fields
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
        if (isGeneratingRef.current || isLoading || isImageLoading) return;
        isGeneratingRef.current = true;
        setIsLoading(true);
        setTextLoadingStep('Preparing prompt...');
        setError(null);
        setDescription('');
        setActiveTextModel('');

        try {
            const result = await generateVividDescription(
                generatedPrompt,
                textModel,
                'generate',
                (step) => setTextLoadingStep(step)
            );
            setDescriptionTask('generate');
            setDescription(result.description);
            setActiveTextModel(result.model || textModel);
        } catch (err: unknown) {
            reportRequestError(err, setError);
        } finally {
            setIsLoading(false);
            setTextLoadingStep('');
            isGeneratingRef.current = false;
        }
    };

    const handleGenerateImage = async (customPrompt?: string) => {
        if (isGeneratingRef.current || isLoading || isImageLoading) return;
        const promptToRun = (customPrompt || generatedPrompt).trim();
        if (!promptToRun) return;

        isGeneratingRef.current = true;
        setIsImageLoading(true);
        setImageLoadingStep('Preparing prompt...');
        setImageError(null);
        setGeneratedImages([]);
        setActiveImageModel('');

        try {
            // Distinct seed per variation
            const requests = Array.from({ length: numImages }, () =>
                generateImage(
                    promptToRun,
                    imageModel,
                    aspectRatio,
                    Math.floor(Math.random() * 1_000_000_000),
                    (step) => setImageLoadingStep(step)
                ),
            );
            const results = await Promise.allSettled(requests);
            const ok = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
            if (ok.length === 0) {
                const firstErr = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
                throw firstErr?.reason instanceof Error ? firstErr.reason : new Error('Image generation failed.');
            }
            setGeneratedImages(ok.map(v => v.image));
            setActiveImageModel(ok[0].model || imageModel);
        } catch (err: unknown) {
            reportRequestError(err, setImageError);
        } finally {
            setIsImageLoading(false);
            setImageLoadingStep('');
            isGeneratingRef.current = false;
        }
    };

    const handleFile = (file?: File) => {
        if (!file) return;
        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            setError('Please upload a valid image file (JPEG, PNG, or WebP).');
            return;
        }
        const MAX_SIZE_BYTES = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE_BYTES) {
            setError('Image file is too large. Maximum allowed size is 5MB.');
            return;
        }

        setError(null);
        const reader = new FileReader();
        reader.onload = () => setEditImage(reader.result as string);
        reader.onerror = () => setError('Failed to read image file. Please try another image.');
        reader.readAsDataURL(file);
    };

    const handleGenerateEditPrompt = async () => {
        if (!editInstruction.trim() || isGeneratingRef.current || isLoading || isImageLoading) return;
        isGeneratingRef.current = true;
        setIsLoading(true);
        setTextLoadingStep('Preparing edit prompt...');
        setError(null);
        setDescription('');
        setActiveTextModel('');

        try {
            const result = await generateVividDescription(
                editInstruction,
                textModel,
                'edit',
                (step) => setTextLoadingStep(step)
            );
            setDescriptionTask('edit');
            setDescription(result.description);
            setActiveTextModel(result.model || textModel);
        } catch (err: unknown) {
            reportRequestError(err, setError);
        } finally {
            setIsLoading(false);
            setTextLoadingStep('');
            isGeneratingRef.current = false;
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

    if (!authReady) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            </div>
        );
    }

    if (!session) {
        return (
            <LoginScreen
                initialMode={authMode}
                initialError={authError}
                onPasswordUpdated={() => setAuthMode('signin')}
            />
        );
    }

    return (
        <div className="min-h-screen font-sans text-slate-200 bg-slate-950">
            <Header email={session.user.email ?? undefined} onSignOut={() => supabase.auth.signOut()} />
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
                            <SuggestionChips value={promptData.details} options={DETAIL_OPTIONS} onChange={(v) => handleInputChange('details', v)} />
                        </PromptInputSection>

                        <PromptInputSection title="Style & Camera">
                            {field('style', 'Art style  ·  e.g. cinematic concept art, photorealistic, anime, oil painting')}
                            <SuggestionChips value={promptData.style} options={STYLE_OPTIONS} onChange={(v) => handleInputChange('style', v)} />
                            {field('lighting', 'Lighting  ·  e.g. golden-hour backlight, soft god rays, neon glow')}
                            <SuggestionChips value={promptData.lighting} options={LIGHTING_OPTIONS} onChange={(v) => handleInputChange('lighting', v)} />
                            {field('camera', 'Camera & quality  ·  e.g. wide shot, 35mm lens, sharp focus, 8k detail')}
                            <SuggestionChips value={promptData.camera} options={CAMERA_OPTIONS} onChange={(v) => handleInputChange('camera', v)} />
                        </PromptInputSection>

                        <PromptInputSection title="Negative Prompt">
                            {field('negativePrompt', 'Things to avoid  ·  e.g. blurry, watermark, extra limbs, text, low quality')}
                            <SuggestionChips value={promptData.negativePrompt} options={NEGATIVE_OPTIONS} onChange={(v) => handleInputChange('negativePrompt', v)} />
                            <p className="text-[11px] leading-relaxed text-slate-500">
                                Included in your copy-ready prompt for other tools. The FLUX preview here does not support negative prompts.
                            </p>
                        </PromptInputSection>

                        <PromptInputSection title="Model Options">
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="image-model" className="text-xs font-medium text-slate-500">Image model</label>
                                        <select id="image-model" value={imageModel} onChange={(e) => setImageModel(e.target.value)} className={selectClass}>
                                            {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="text-model" className="text-xs font-medium text-slate-500">Text enhancement model</label>
                                        <select id="text-model" value={textModel} onChange={(e) => setTextModel(e.target.value)} className={selectClass}>
                                            {TEXT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="aspect-ratio" className="text-xs font-medium text-slate-500">Aspect ratio</label>
                                        <select id="aspect-ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className={selectClass}>
                                            {ASPECT_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="num-images" className="text-xs font-medium text-slate-500">Number of image variations</label>
                                        <select id="num-images" value={numImages} onChange={(e) => setNumImages(Number(e.target.value))} className={selectClass}>
                                            <option value={1}>1 image</option>
                                            <option value={2}>2 variations</option>
                                            <option value={3}>3 variations</option>
                                            <option value={4}>4 variations</option>
                                        </select>
                                    </div>
                                </div>
                                <p className="rounded-lg border border-white/5 bg-slate-950/50 p-2.5 text-[11px] leading-relaxed text-slate-500">
                                    Images and text run on <span className="text-slate-300 font-medium">NVIDIA</span> models. Requests are capped at about 25 seconds; if a slow model runs out of time, try again or switch to Auto. All keys remain protected server-side.
                                </p>
                            </div>
                        </PromptInputSection>

                        <PromptInputSection title="Photo Editing Prompt">
                            <div className="flex flex-col gap-3">
                                {editImage ? (
                                    <div className="relative">
                                        <img src={editImage} alt="reference" className="max-h-52 w-full rounded-xl border border-white/10 bg-slate-950/60 object-contain" />
                                        <button
                                            onClick={() => setEditImage(null)}
                                            className="absolute right-2 top-2 rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-400 transition hover:border-violet-500/40 hover:bg-slate-950/60">
                                        <ImageIcon />
                                        <span>Click to upload a reference photo</span>
                                        <span className="text-[11px] text-slate-500">Stays in your browser — used as your reference</span>
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                                    </label>
                                )}
                                <textarea
                                    value={editInstruction}
                                    onChange={(e) => setEditInstruction(e.target.value)}
                                    placeholder="Describe the edit  ·  e.g. turn this into a 3D Pixar-anime character, keep the likeness"
                                    rows={2}
                                    className={fieldClass}
                                />
                                <button
                                    onClick={handleGenerateEditPrompt}
                                    disabled={!editInstruction.trim() || isLoading || isImageLoading}
                                    className="flex items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <GenerateIcon />
                                    {isLoading ? 'Generating…' : 'Generate editing prompt'}
                                </button>
                                <p className="text-[11px] leading-relaxed text-slate-500">
                                    Produces a ready-to-paste editing prompt (shown on the right). Use it together with your photo in any image
                                    editor that supports edits.
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
                                disabled={!canGenerate || isLoading || isImageLoading}
                                className="flex items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                            >
                                <GenerateIcon />
                                {isLoading ? (textLoadingStep || 'Enhancing…') : 'Enhance with AI'}
                            </button>
                            <button
                                onClick={() => handleGenerateImage()}
                                disabled={!canGenerate || isLoading || isImageLoading}
                                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <ImageIcon />
                                {isImageLoading ? (imageLoadingStep || 'Generating…') : 'Generate Image'}
                            </button>
                        </div>

                        <ImageDescriptionDisplay
                            description={description}
                            isLoading={isLoading}
                            loadingStep={textLoadingStep}
                            error={error}
                            activeProvider={badge(activeTextModel)}
                            onClear={() => { setDescription(''); setError(null); setActiveTextModel(''); }}
                            onUseForGeneration={descriptionTask === 'generate' ? (prompt) => handleGenerateImage(prompt) : undefined}
                        />
                        <GeneratedImageDisplay
                            images={generatedImages}
                            count={numImages}
                            isLoading={isImageLoading}
                            loadingStep={imageLoadingStep}
                            error={imageError}
                            activeProvider={badge(activeImageModel)}
                            onDismissError={() => setImageError(null)}
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
