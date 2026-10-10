import type { Deadline } from "../deadline";

export interface ImageGenerationOptions {
  prompt: string;
  aspectRatio?: string;
  seed?: number;
  steps?: number;
  model?: string;
  /** Shared request time budget; every attempt must fit inside it. */
  deadline?: Deadline;
}

export interface ImageGenerationResult {
  image: string; // base64 payload
  sanitizedPrompt: string;
  provider: string;
  model: string;
  /** Upstream request id, for correlating with the provider's logs. */
  providerRequestId?: string;
}

export interface ImageProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  getSupportedModels(): string[];
  getDefaultModel(): string;
  generate(options: ImageGenerationOptions): Promise<ImageGenerationResult>;
}
