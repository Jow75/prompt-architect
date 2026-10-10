import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult } from "./types";
import { createDeadline, type Deadline } from "../deadline";
import { ProviderError, isAbortError, isRetryable } from "../errors";

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
 * so FLUX receives plain natural language.
 */
function stripEmphasisSyntax(p: string): string {
  let s = p;
  s = s.replace(/\(+([^:()]+):[0-9.]+\)+/g, "$1");
  s = s.replace(/\[+([^:[\]]+):[0-9.]+\]+/g, "$1");
  s = s.replace(/[\(\)\[\]\{\}]/g, "");
  s = s.replace(/<lora:[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "3:2": { width: 1216, height: 832 },
  "2:3": { width: 832, height: 1216 },
  "3:4": { width: 896, height: 1152 },
  "4:3": { width: 1152, height: 896 },
};

// Per-model attempt policy, sized from measurements on this account:
//   flux.2-klein-4b  ~3-5s  -> short cap, one retry on a transient failure.
//   flux.1-dev       ~7-30s -> one attempt that may use almost the whole budget.
// flux.1-schnell is intentionally absent: it stopped responding on this account.
const MODELS: Record<string, { capMs: number; attempts: number }> = {
  "flux.2-klein-4b": { capMs: 12_000, attempts: 2 },
  "flux.1-dev": { capMs: 23_000, attempts: 1 },
};
const DEFAULT_MODEL = "flux.2-klein-4b";
// A retry is only worth starting if a typical Klein generation still fits.
const MIN_RETRY_BUDGET_MS = 8_000;

export class NvidiaImageProvider implements ImageProvider {
  public readonly id = "nvidia";
  public readonly displayName = "NVIDIA FLUX";

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith("nvapi-"));
  }

  public getSupportedModels(): string[] {
    return Object.keys(MODELS);
  }

  public getDefaultModel(): string {
    return DEFAULT_MODEL;
  }

  private getApiKey(): string | null {
    const key = process.env.NVIDIA_API_KEY?.trim();
    if (key && key !== "undefined" && key.length > 0) return key;
    return null;
  }

  public async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderError("config", "The NVIDIA API key is not configured on the server.");
    }

    let mainPrompt = options.prompt || "";
    const negativeIndex = mainPrompt.indexOf(" --no ");
    if (negativeIndex !== -1) {
      mainPrompt = mainPrompt.substring(0, negativeIndex);
    }
    const sanitizedPrompt = stripEmphasisSyntax(mainPrompt);

    const dims = ASPECT_RATIO_DIMENSIONS[options.aspectRatio || "1:1"] || ASPECT_RATIO_DIMENSIONS["1:1"];

    const requested = (options.model || "auto").split("/").pop()!.trim();
    const modelId = requested === "auto" ? DEFAULT_MODEL : requested;
    const policy = MODELS[modelId];
    if (!policy) {
      throw new ProviderError("client", `Unsupported image model '${requested}'.`);
    }

    const deadline = options.deadline ?? createDeadline();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < policy.attempts; attempt++) {
      if (attempt > 0 && deadline.remaining() < MIN_RETRY_BUDGET_MS) break;
      try {
        return await this.callOnce(apiKey, modelId, sanitizedPrompt, dims, options, policy.capMs, deadline);
      } catch (err: any) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        console.warn(`[NVIDIA] Attempt ${attempt + 1} with ${modelId} failed (${err.kind}): ${err.message}`);
        if (err.kind === "rate_limited") {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    }

    throw lastError || new ProviderError("unavailable", "NVIDIA image generation failed.");
  }

  private async callOnce(
    apiKey: string,
    modelId: string,
    prompt: string,
    dims: { width: number; height: number },
    options: ImageGenerationOptions,
    capMs: number,
    deadline: Deadline
  ): Promise<ImageGenerationResult> {
    const requestBody: Record<string, any> = { prompt, width: dims.width, height: dims.height };
    if (typeof options.seed === "number") {
      requestBody.seed = options.seed;
    }
    if (modelId.includes("klein")) {
      requestBody.steps = options.steps || 4;
    } else {
      // flux.1-dev
      requestBody.mode = "base";
      requestBody.cfg_scale = 3.5;
      requestBody.steps = options.steps || Number(process.env.NVIDIA_IMAGE_STEPS) || 28;
    }

    const t0 = Date.now();
    let response: Response;
    try {
      response = await fetch(`https://ai.api.nvidia.com/v1/genai/black-forest-labs/${modelId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        // Leave 1.5s of the request budget for decoding and sending the response.
        signal: deadline.signal(capMs, 1500),
        body: JSON.stringify(requestBody),
      });
    } catch (err: any) {
      if (isAbortError(err)) {
        throw new ProviderError("timeout", "The image model took too long to respond. Please try again.");
      }
      throw new ProviderError("unavailable", "Could not reach the image provider. Please try again.");
    }

    const providerRequestId = response.headers.get("nvcf-reqid") || undefined;
    console.log(
      `[NVIDIA] ${modelId} ${dims.width}x${dims.height} -> ${response.status} in ${Date.now() - t0}ms (nvcf-reqid: ${providerRequestId ?? "n/a"})`
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[NVIDIA] ${modelId} error body:`, errText.slice(0, 300));
      const lower = errText.toLowerCase();

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError("config", "The image provider rejected the server's API key.");
      }
      if (response.status === 429) {
        throw new ProviderError("rate_limited", "The image provider is rate-limiting requests. Please wait a moment and try again.");
      }
      if (response.status === 422 || lower.includes("safety") || lower.includes("content filter")) {
        throw new ProviderError("safety", "NVIDIA content safety filter flagged this prompt. Please adjust the prompt wording.");
      }
      if (response.status === 400 || response.status === 404) {
        throw new ProviderError("client", "The image provider rejected the request parameters.");
      }
      throw new ProviderError("unavailable", "The image provider is temporarily unavailable. Please try again.");
    }

    let resJson: any;
    try {
      resJson = await response.json();
    } catch (err: any) {
      if (isAbortError(err)) {
        throw new ProviderError("timeout", "The image model took too long to respond. Please try again.");
      }
      throw new ProviderError("unavailable", "The image provider returned an unreadable response.");
    }

    let base64Image: string | null = null;
    if (typeof resJson?.artifacts?.[0]?.base64 === "string") {
      base64Image = resJson.artifacts[0].base64;
    } else if (typeof resJson?.image === "string") {
      base64Image = resJson.image;
    } else if (typeof resJson?.data?.[0]?.b64_json === "string") {
      base64Image = resJson.data[0].b64_json;
    }

    if (!base64Image) {
      throw new ProviderError("unavailable", "The image provider completed but returned no image data.");
    }

    // Check for black frame safety block
    if (isLikelyFilteredImage(base64Image)) {
      throw new ProviderError(
        "safety",
        "NVIDIA's safety filter blocked this image — the prompt was flagged and returned a black frame. Please soften the prompt terms."
      );
    }

    return { image: base64Image, sanitizedPrompt: prompt, provider: this.id, model: modelId, providerRequestId };
  }
}
