import { GoogleGenAI } from "@google/genai";
import { providerRegistry } from "./providers/registry";

export interface HandlerResult {
  status: number;
  body: Record<string, any>;
}

/**
 * Returns an available API key and detected provider format.
 */
function getApiKeyAndProvider(): { apiKey: string; isOpenAI: boolean } | null {
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  const hasNvidia = nvidiaKey !== undefined && nvidiaKey !== "undefined" && nvidiaKey !== "";

  if (hasNvidia && nvidiaKey!.startsWith("nvapi-")) {
    return { apiKey: nvidiaKey!, isOpenAI: false };
  }

  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  const hasOpenAI = openAIKey !== undefined && openAIKey !== "undefined" && openAIKey !== "";

  if (hasOpenAI && openAIKey!.startsWith("sk-")) {
    return { apiKey: openAIKey!, isOpenAI: true };
  }

  if (hasNvidia && nvidiaKey!.startsWith("sk-")) {
    return { apiKey: nvidiaKey!, isOpenAI: true };
  }

  if (hasOpenAI && openAIKey!.startsWith("nvapi-")) {
    return { apiKey: openAIKey!, isOpenAI: false };
  }

  if (hasNvidia) {
    return { apiKey: nvidiaKey!, isOpenAI: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 1. Text Enhancement / Scene Description
// ---------------------------------------------------------------------------
export async function handleGenerateDescription(input: {
  prompt?: string;
  provider?: string;
  model?: string;
  task?: string;
}): Promise<HandlerResult> {
  try {
    const { prompt, provider = "auto", model: requestedModel = "auto", task = "generate" } = input;
    if (!prompt || !prompt.trim()) {
      return {
        status: 400,
        body: {
          success: false,
          error: { code: "INVALID_INPUT", message: "Prompt text is required." },
        },
      };
    }

    // Default NVIDIA chat model is meta/llama-3.2-11b-vision-instruct (fast 5s response, active on NIM)
    const defaultNvidiaModel = process.env.NVIDIA_CHAT_MODEL || "meta/llama-3.2-11b-vision-instruct";
    const nvidiaChatModel =
      requestedModel && requestedModel !== "auto" ? requestedModel : defaultNvidiaModel;

    const generateInstruction = `You are a world-class AI image-prompt engineer (a senior concept artist + prompt specialist). The user gives you an idea, a photo description, or a partial prompt. Produce a complete, professional, ready-to-use prompt package.

PRESERVE the user's core subject, concept and intent — never replace their idea or add unrelated subjects.

Output EXACTLY these labeled sections, in plain text. Do NOT use markdown symbols like #, *, or backticks.

PROMPT:
<One polished, richly detailed, ready-to-paste image-generation prompt. Cover: subject specifics, composition and framing, setting/background, lighting, color palette, mood/atmosphere, art style or medium, and camera/lens or render quality. Be vivid and specific; front-load the most important elements. Keep it tasteful and safe-for-work.>

NEGATIVE PROMPT:
<A concise comma-separated list of things to avoid for this image, e.g. blurry, deformed hands, extra limbs, watermark, text.>

TIPS:
- <2 to 4 short, practical tips for getting the best result from this prompt.>

Do not add any other text, preamble, or explanation outside these three sections.`;

    const editInstruction = `You are a world-class photo-editing prompt engineer. The user wants to transform an EXISTING reference photo. Produce a complete, professional editing prompt package.

By DEFAULT preserve the subject's identity — the same face and facial features, hairstyle, body proportions, skin tone, pose, and background — and change ONLY what the user's instruction asks for. Apply exactly the transformation they describe.

Output EXACTLY these labeled sections, in plain text. Do NOT use markdown symbols like #, *, or backticks.

PROMPT:
<One polished, ready-to-paste editing prompt directed at an image editor/model. Refer to "the provided photo". Clearly state the transformation, what to preserve (identity and key features), the target style, lighting, level of detail, and output quality. Be specific. Keep it tasteful and safe-for-work.>

NEGATIVE PROMPT:
<A concise comma-separated list of things to avoid, e.g. different person, altered identity, distorted face, extra limbs, watermark, text.>

TIPS:
- <2 to 4 short, practical tips for a faithful edited result.>

Do not add any other text, preamble, or explanation outside these three sections.`;

    const systemInstruction = task === "edit" ? editInstruction : generateInstruction;

    const openAIKey = process.env.OPENAI_API_KEY?.trim();
    const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    const hasGemini = Boolean(geminiKey && geminiKey.startsWith("AIzaSy"));
    const hasOpenAI = Boolean(openAIKey && openAIKey.startsWith("sk-"));
    const hasNvidia = Boolean(nvidiaKey && nvidiaKey.startsWith("nvapi-"));

    let providerSequence: string[] = [];
    if (provider === "gemini") {
      providerSequence = ["gemini"];
    } else if (provider === "openai") {
      providerSequence = ["openai"];
    } else if (provider === "nvidia") {
      providerSequence = ["nvidia"];
    } else {
      providerSequence = [];
      if (hasNvidia) providerSequence.push("nvidia");
      if (hasOpenAI) providerSequence.push("openai");
      if (hasGemini) providerSequence.push("gemini");

      if (providerSequence.length === 0) {
        const fallbackObj = getApiKeyAndProvider();
        if (fallbackObj) {
          providerSequence.push(fallbackObj.isOpenAI ? "openai" : "nvidia");
        }
        if (geminiKey) {
          providerSequence.push("gemini");
        }
      }
    }

    if (providerSequence.length === 0) {
      return {
        status: 500,
        body: {
          success: false,
          error: {
            code: "SERVER_CONFIG_ERROR",
            message: "No AI text generation keys are configured on the server.",
          },
        },
      };
    }

    let lastError: Error | null = null;
    let finalDescription = "";
    let finalProviderUsed = "";
    let finalModelUsed = "";

    for (const currentProvider of providerSequence) {
      try {
        console.log(`[TextGen] Attempting Scene Description with provider: ${currentProvider}...`);
        if (currentProvider === "nvidia") {
          const keyToUse = nvidiaKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No NVIDIA API key found.");

          // Try primary fast model, then 90b vision instruct as fallback
          const candidateModels =
            requestedModel && requestedModel !== "auto"
              ? [requestedModel]
              : [nvidiaChatModel, "meta/llama-3.2-90b-vision-instruct"];

          let chatSuccess = false;
          for (const m of candidateModels) {
            try {
              const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${keyToUse}`,
                  "Content-Type": "application/json",
                },
                signal: AbortSignal.timeout(18000),
                body: JSON.stringify({
                  model: m,
                  messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: `PROMPT: ${prompt}\n\nDESCRIPTION:` },
                  ],
                  temperature: 0.7,
                  max_tokens: 1024,
                }),
              });

              if (!response.ok) {
                console.warn(`[NVIDIA Chat] Model ${m} returned HTTP ${response.status}`);
                continue;
              }

              const data = (await response.json()) as any;
              const content =
                data.choices?.[0]?.message?.content?.trim() ||
                data.choices?.[0]?.message?.reasoning_content?.trim();

              if (content) {
                finalDescription = content;
                finalModelUsed = m;
                finalProviderUsed = "nvidia";
                chatSuccess = true;
                break;
              }
            } catch (err: any) {
              console.warn(`[NVIDIA Chat] Model ${m} failed:`, err.message);
            }
          }

          if (chatSuccess) break;
          throw new Error("All candidate NVIDIA chat models failed to produce a description.");
        } else if (currentProvider === "gemini") {
          if (!geminiKey) throw new Error("No Gemini API Key defined in environment.");
          const aiClient = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } },
          });
          const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `${systemInstruction}\n\nPROMPT: ${prompt}\n\nDESCRIPTION:`,
          });
          if (response.text) {
            finalDescription = response.text.trim();
            finalProviderUsed = "gemini";
            finalModelUsed = "gemini-2.5-flash";
            break;
          }
          throw new Error("Gemini returned an empty description response.");
        } else if (currentProvider === "openai") {
          const keyToUse = openAIKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No OpenAI API key found.");
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${keyToUse}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: `PROMPT: ${prompt}\n\nDESCRIPTION:` },
              ],
              temperature: 0.7,
              max_tokens: 1024,
            }),
          });
          if (!response.ok) {
            throw new Error(`OpenAI API returned status ${response.status}: ${await response.text()}`);
          }
          const data = (await response.json()) as any;
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            finalDescription = content;
            finalProviderUsed = "openai";
            finalModelUsed = "gpt-4o-mini";
            break;
          }
          throw new Error("OpenAI returned an empty description response.");
        }
      } catch (err: any) {
        console.error(`[TextGen] Provider ${currentProvider} failed:`, err.message);
        lastError = err;
      }
    }

    if (!finalDescription) {
      throw lastError || new Error("Failed to generate description with any configured provider.");
    }

    return {
      status: 200,
      body: {
        success: true,
        description: finalDescription,
        provider: finalProviderUsed,
        model: finalModelUsed,
      },
    };
  } catch (error: any) {
    console.error("Error in handleGenerateDescription:", error);
    return {
      status: 503,
      body: {
        success: false,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: error.message || "Failed to generate prompt description.",
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Image Generation via Provider Architecture
// ---------------------------------------------------------------------------
export async function handleGenerateImage(input: {
  prompt?: string;
  provider?: string;
  model?: string;
  aspectRatio?: string;
  seed?: number;
  width?: number;
  height?: number;
}): Promise<HandlerResult> {
  try {
    const { prompt, provider = "auto", model = "auto", aspectRatio = "1:1", seed, width, height } = input;
    if (!prompt || !prompt.trim()) {
      return {
        status: 400,
        body: {
          success: false,
          error: { code: "INVALID_INPUT", message: "Prompt text is required." },
        },
      };
    }

    console.log(`[ImageGen] Processing image generation request (provider: ${provider}, model: ${model}, aspect: ${aspectRatio})...`);

    const result = await providerRegistry.generateImageWithFallback(
      {
        prompt,
        model,
        aspectRatio,
        seed,
        width,
        height,
      },
      provider
    );

    return {
      status: 200,
      body: {
        success: true,
        image: result.image,
        sanitizedPrompt: result.sanitizedPrompt,
        provider: result.provider,
        model: result.model,
      },
    };
  } catch (error: any) {
    console.error("Error in handleGenerateImage:", error);

    const isSafety = Boolean(error.isSafetyViolation);
    const status = isSafety ? 422 : 503;
    const code = isSafety ? "SAFETY_VIOLATION" : "PROVIDER_UNAVAILABLE";

    return {
      status,
      body: {
        success: false,
        error: {
          code,
          message: error.message || "Failed to generate image.",
        },
      },
    };
  }
}
