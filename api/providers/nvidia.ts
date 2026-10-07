import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult } from "./types";

/**
 * NVIDIA's FLUX safety filter signals a blocked prompt by returning a solid black
 * frame rather than an HTTP 4xx/5xx error. We sample the first ~100 bytes of raw base64.
 */
function isLikelyFilteredImage(base64: string): boolean {
  if (!base64 || base64.length < 500) return false;
  const sample = base64.slice(0, 120);
  const repeatedA = (sample.match(/A/g) || []).length;
  return repeatedA > 85;
}

/**
 * Strips Stable-Diffusion-specific emphasis syntax like ((subject):1.5) or {subject}
 * so FLUX / DALL-E / Gemini receive plain natural language.
 */
function stripEmphasisSyntax(p: string): string {
  let s = p;
  s = s.replace(/\(+([^:()]+):[0-9.]+\)+/g, "$1");
  s = s.replace(/\[+([^:[\]]+):[0-9.]+\]+/g, "$1");
  s = s.replace(/[\(\)\[\]\{\}]/g, "");
  s = s.replace(/<lora:[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "3:2": { width: 1216, height: 832 },
  "2:3": { width: 832, height: 1216 },
  "3:4": { width: 896, height: 1152 },
  "4:3": { width: 1152, height: 896 },
};

export class NvidiaImageProvider implements ImageProvider {
  public readonly id = "nvidia";
  public readonly displayName = "NVIDIA FLUX";

  private readonly supportedModels = [
    "flux.2-klein-4b",
    "flux.1-schnell",
    "flux.1-dev",
  ];

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith("nvapi-"));
  }

  public getSupportedModels(): string[] {
    return [...this.supportedModels];
  }

  public getDefaultModel(): string {
    return "flux.2-klein-4b";
  }

  private getApiKey(): string | null {
    const key = process.env.NVIDIA_API_KEY?.trim();
    if (key && key !== "undefined" && key.length > 0) return key;
    return null;
  }

  public async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("NVIDIA API key is not configured.");
    }

    let mainPrompt = options.prompt || "";
    const negativeIndex = mainPrompt.indexOf(" --no ");
    if (negativeIndex !== -1) {
      mainPrompt = mainPrompt.substring(0, negativeIndex);
    }
    const sanitizedPrompt = stripEmphasisSyntax(mainPrompt);

    // Determine dimensions from aspect ratio or options
    const ratio = options.aspectRatio || "1:1";
    const defaultDims = ASPECT_RATIO_DIMENSIONS[ratio] || { width: 1024, height: 1024 };
    const width = options.width || defaultDims.width;
    const height = options.height || defaultDims.height;

    // Normalize requested model
    const normalize = (m: string) => (m.includes("/") ? m.split("/").pop()! : m).trim();
    const rawModel = options.model ? normalize(options.model) : "auto";

    // Build list of models to try.
    // If user asked for a specific model, prioritize it.
    // Default fast & high quality model for NVIDIA is flux.2-klein-4b (verified working in ~2s).
    const modelsToTry: string[] = [];
    if (rawModel !== "auto" && this.supportedModels.includes(rawModel)) {
      modelsToTry.push(rawModel);
    } else {
      modelsToTry.push("flux.2-klein-4b", "flux.1-schnell", "flux.1-dev");
    }

    let lastError: Error | null = null;

    for (const modelId of modelsToTry) {
      try {
        console.log(`[NVIDIA] Dispatching generation request to model: ${modelId} (${width}x${height})...`);
        const isSchnell = modelId.includes("schnell");
        const isKlein = modelId.includes("klein");

        const requestBody: Record<string, any> = {
          prompt: sanitizedPrompt,
          width,
          height,
        };

        if (typeof options.seed === "number") {
          requestBody.seed = options.seed;
        }

        if (isSchnell) {
          requestBody.mode = "base";
          requestBody.cfg_scale = 0;
          requestBody.steps = 4;
        } else if (isKlein) {
          requestBody.steps = options.steps || 4;
        } else {
          // flux.1-dev
          requestBody.mode = "base";
          requestBody.cfg_scale = 3.5;
          requestBody.steps = options.steps || Number(process.env.NVIDIA_IMAGE_STEPS) || 28;
        }

        const t0 = Date.now();
        const response = await fetch(`https://ai.api.nvidia.com/v1/genai/black-forest-labs/${modelId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(24000), // Enforce 24s timeout for Netlify serverless constraints
          body: JSON.stringify(requestBody),
        });

        const elapsedMs = Date.now() - t0;
        console.log(`[NVIDIA] Response status from ${modelId}: ${response.status} in ${elapsedMs}ms`);

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[NVIDIA] Model ${modelId} returned HTTP ${response.status}:`, errText);
          
          // Safety or client parameter rejection - don't retry same model
          if (response.status === 422 || errText.toLowerCase().includes("safety") || errText.toLowerCase().includes("filter")) {
            const safetyErr = new Error("NVIDIA content safety filter flagged this prompt. Please adjust the prompt wording.");
            (safetyErr as any).isSafetyViolation = true;
            throw safetyErr;
          }

          throw new Error(`NVIDIA model ${modelId} failed (${response.status}): ${errText.slice(0, 200)}`);
        }

        const resJson = (await response.json()) as any;
        let base64Image: string | null = null;

        if (resJson.artifacts && resJson.artifacts[0] && typeof resJson.artifacts[0].base64 === "string") {
          base64Image = resJson.artifacts[0].base64;
        } else if (typeof resJson.image === "string") {
          base64Image = resJson.image;
        } else if (resJson.data && resJson.data[0] && typeof resJson.data[0].b64_json === "string") {
          base64Image = resJson.data[0].b64_json;
        }

        if (!base64Image) {
          throw new Error(`NVIDIA model ${modelId} completed but returned no valid base64 image data.`);
        }

        // Check for black frame safety block
        if (isLikelyFilteredImage(base64Image)) {
          const safetyErr = new Error(
            "NVIDIA's safety filter blocked this image — the prompt was flagged as explicit and returned a black frame. Please soften the prompt terms."
          );
          (safetyErr as any).isSafetyViolation = true;
          throw safetyErr;
        }

        return {
          image: base64Image,
          sanitizedPrompt,
          provider: this.id,
          model: modelId,
        };
      } catch (err: any) {
        if (err.isSafetyViolation) {
          // Re-throw immediately: safety violations should NEVER fall back or retry
          throw err;
        }
        lastError = err;
        console.warn(`[NVIDIA] Generation attempt with ${modelId} failed:`, err.message);
      }
    }

    throw lastError || new Error("All configured NVIDIA FLUX image models failed to generate an image.");
  }
}
