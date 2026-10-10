import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult } from "./types";
import { NvidiaImageProvider } from "./nvidia";
import { ProviderError } from "../errors";

// Image providers available to the app. NVIDIA FLUX is the only one: the former
// OpenAI (dall-e-3) and Gemini (gemini-2.5-flash-image) providers were removed
// after both models were retired upstream. To add a provider, implement
// ImageProvider and register it here; retries stay inside each provider so one
// request never fans out across providers and outruns the time budget.
export class ImageProviderRegistry {
  private providers: Map<string, ImageProvider> = new Map();
  private defaultId = "nvidia";

  constructor() {
    this.register(new NvidiaImageProvider());
  }

  public register(provider: ImageProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): ImageProvider | undefined {
    return this.providers.get(id);
  }

  /** Every image model the server accepts, across providers. */
  public getSupportedModels(): string[] {
    return Array.from(this.providers.values()).flatMap((p) => p.getSupportedModels());
  }

  public async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const provider = this.providers.get(this.defaultId);
    if (!provider || !provider.isConfigured()) {
      throw new ProviderError("config", "No image generation provider is configured on this server. Please verify the server API key.");
    }
    return provider.generate(options);
  }
}

export const providerRegistry = new ImageProviderRegistry();
