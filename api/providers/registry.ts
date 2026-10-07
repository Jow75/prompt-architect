import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult, ImageProviderStatus } from "./types";
import { NvidiaImageProvider } from "./nvidia";
import { OpenAIImageProvider } from "./openai";
import { GeminiImageProvider } from "./gemini";

export class ImageProviderRegistry {
  private providers: Map<string, ImageProvider> = new Map();

  constructor() {
    this.register(new NvidiaImageProvider());
    this.register(new OpenAIImageProvider());
    this.register(new GeminiImageProvider());
  }

  public register(provider: ImageProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): ImageProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Returns metadata and active availability for all providers.
   */
  public getStatusList(): ImageProviderStatus[] {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.id,
      displayName: p.displayName,
      isConfigured: p.isConfigured(),
      supportedModels: p.getSupportedModels(),
      defaultModel: p.getDefaultModel(),
    }));
  }

  /**
   * Executes image generation according to NVIDIA-first strategy with strict fallback guards.
   *
   * Fallback Rules (Section 12 of Engineering Directive):
   * - Preferred provider is attempted first (default: NVIDIA).
   * - Fallback happens ONLY on genuine provider/network/server errors (5xx, timeouts).
   * - NEVER fall back on:
   *   - Safety filter rejections (422 / content policy)
   *   - Invalid user prompts / client parameters
   *   - Authentication / quota failures
   */
  public async generateImageWithFallback(
    options: ImageGenerationOptions,
    preferredProvider = "auto"
  ): Promise<ImageGenerationResult> {
    const sequence: ImageProvider[] = [];

    const nvidia = this.providers.get("nvidia");
    const openai = this.providers.get("openai");
    const gemini = this.providers.get("gemini");

    if (preferredProvider !== "auto") {
      const selected = this.providers.get(preferredProvider);
      if (selected && selected.isConfigured()) {
        sequence.push(selected);
      } else if (selected && !selected.isConfigured()) {
        throw new Error(`The requested provider '${selected.displayName}' is not configured on the server.`);
      }
    } else {
      // Auto / NVIDIA-First sequence
      if (nvidia && nvidia.isConfigured()) sequence.push(nvidia);
      if (openai && openai.isConfigured()) sequence.push(openai);
      if (gemini && gemini.isConfigured()) sequence.push(gemini);
    }

    if (sequence.length === 0) {
      throw new Error("No image generation provider is currently configured on this server. Please verify server API keys.");
    }

    let lastError: Error | null = null;

    for (let i = 0; i < sequence.length; i++) {
      const provider = sequence[i];
      try {
        console.log(`[ProviderRegistry] Dispatching to provider: ${provider.displayName}...`);
        const result = await provider.generate(options);
        return result;
      } catch (err: any) {
        lastError = err;

        // CRITICAL GUARD: Do NOT fall back on content safety rejections or bad client input
        if (err.isSafetyViolation || err.isClientError) {
          console.warn(`[ProviderRegistry] Non-retryable error (${err.isSafetyViolation ? 'safety' : 'client input'}) in ${provider.displayName}; stopping fallback sequence.`);
          throw err;
        }

        const isLast = i === sequence.length - 1;
        if (!isLast) {
          console.warn(`[ProviderRegistry] Provider ${provider.displayName} failed (${err.message}). Trying backup provider...`);
        }
      }
    }

    throw lastError || new Error("All available image generation providers failed to fulfill the request.");
  }
}

export const providerRegistry = new ImageProviderRegistry();
