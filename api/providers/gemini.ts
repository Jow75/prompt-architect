import { GoogleGenAI } from "@google/genai";
import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult } from "./types";

export class GeminiImageProvider implements ImageProvider {
  public readonly id = "gemini";
  public readonly displayName = "Google Gemini";

  private readonly supportedModels = ["gemini-2.5-flash-image"];

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith("AIzaSy"));
  }

  public getSupportedModels(): string[] {
    return [...this.supportedModels];
  }

  public getDefaultModel(): string {
    return "gemini-2.5-flash-image";
  }

  private getApiKey(): string | null {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (key && key !== "undefined" && key.length > 0) return key;
    return null;
  }

  public async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const prompt = options.prompt.trim();
    console.log(`[Gemini] Sending image generation request to gemini-2.5-flash-image...`);

    const aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { imageConfig: { aspectRatio: options.aspectRatio === "16:9" ? "16:9" : "1:1" } },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Image: string | null = null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64Image = part.inlineData.data;
        break;
      }
    }

    if (!base64Image) {
      let refusalText = "";
      for (const part of parts) {
        if (part.text) refusalText += part.text + " ";
      }
      if (refusalText.trim()) {
        const safetyErr = new Error(`Gemini refused image production: "${refusalText.trim()}"`);
        (safetyErr as any).isSafetyViolation = true;
        throw safetyErr;
      }
      throw new Error("Gemini completed successfully but did not produce any valid inline image data.");
    }

    return {
      image: base64Image,
      sanitizedPrompt: prompt,
      provider: this.id,
      model: "gemini-2.5-flash-image",
    };
  }
}
