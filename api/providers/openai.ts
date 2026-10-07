import type { ImageProvider, ImageGenerationOptions, ImageGenerationResult } from "./types";

export class OpenAIImageProvider implements ImageProvider {
  public readonly id = "openai";
  public readonly displayName = "OpenAI DALL-E";

  private readonly supportedModels = ["dall-e-3"];

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.startsWith("sk-"));
  }

  public getSupportedModels(): string[] {
    return [...this.supportedModels];
  }

  public getDefaultModel(): string {
    return "dall-e-3";
  }

  private getApiKey(): string | null {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (key && key !== "undefined" && key.length > 0) return key;
    return null;
  }

  public async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("OpenAI API key is not configured.");
    }

    const prompt = options.prompt.trim();
    const ratio = options.aspectRatio || "1:1";
    let size = "1024x1024";
    if (ratio === "16:9" || ratio === "3:2") {
      size = "1792x1024";
    } else if (ratio === "9:16" || ratio === "2:3" || ratio === "3:4") {
      size = "1024x1792";
    }

    console.log(`[OpenAI] Sending image generation request to DALL-E 3 (${size})...`);

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(24000),
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[OpenAI] DALL-E 3 returned status ${response.status}:`, errText);
      if (errText.toLowerCase().includes("safety") || errText.toLowerCase().includes("content policy")) {
        const safetyErr = new Error("OpenAI safety system rejected this prompt.");
        (safetyErr as any).isSafetyViolation = true;
        throw safetyErr;
      }
      throw new Error(`OpenAI image generation failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    const resJson = (await response.json()) as any;
    let base64Image: string | null = null;

    if (resJson.data?.[0]?.b64_json) {
      base64Image = resJson.data[0].b64_json;
    } else if (resJson.data?.[0]?.url) {
      const imgRes = await fetch(resJson.data[0].url);
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        base64Image = buffer.toString("base64");
      }
    }

    if (!base64Image) {
      throw new Error("Unable to parse image payload from OpenAI response.");
    }

    return {
      image: base64Image,
      sanitizedPrompt: prompt,
      provider: this.id,
      model: "dall-e-3",
    };
  }
}
