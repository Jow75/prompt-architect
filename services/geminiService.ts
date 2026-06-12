// Client-side wrappers for the server API. All keys stay on the backend.
// `model` is the specific model to use (e.g. "flux.1-dev" or a chat model id),
// or "auto" to let the server pick a sensible default.

import { getAccessToken } from './supabase';

async function authedHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function generateVividDescription(
    prompt: string,
    model: string = "auto",
    task: "generate" | "edit" = "generate",
): Promise<{ description: string; provider: string; model: string }> {
    try {
        const response = await fetch("/api/generate-description", {
            method: "POST",
            headers: await authedHeaders(),
            body: JSON.stringify({ prompt, provider: "nvidia", model, task }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server responded with status ${response.status}`);
        }

        const data = await response.json();
        return {
            description: data.description,
            provider: data.provider || "nvidia",
            model: data.model || "",
        };
    } catch (error: any) {
        console.error("Error generating enhanced prompt:", error);
        throw new Error(error.message || "Failed to enhance prompt. Please check your connection and try again.");
    }
}

export async function generateImage(
    prompt: string,
    model: string = "auto",
    aspectRatio: string = "1:1",
    seed?: number,
): Promise<{ image: string; sanitizedPrompt: string; provider: string; model: string }> {
    try {
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: await authedHeaders(),
            body: JSON.stringify({ prompt, provider: "nvidia", model, aspectRatio, seed }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server responded with status ${response.status}`);
        }

        const data = await response.json();
        return {
            image: data.image,
            sanitizedPrompt: data.sanitizedPrompt,
            provider: data.provider || "nvidia",
            model: data.model || "",
        };
    } catch (error: any) {
        console.error("Error generating image:", error);
        throw new Error(error.message || "Failed to generate image. Please check your connection and try again.");
    }
}
