export interface ImageGenerationOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  seed?: number;
  steps?: number;
  model?: string;
}

export interface ImageGenerationResult {
  image: string; // base64 payload
  sanitizedPrompt: string;
  provider: string;
  model: string;
}

export interface ImageProviderStatus {
  name: string;
  displayName: string;
  isConfigured: boolean;
  supportedModels: string[];
  defaultModel: string;
}

export interface ImageProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  getSupportedModels(): string[];
  getDefaultModel(): string;
  generate(options: ImageGenerationOptions): Promise<ImageGenerationResult>;
}
