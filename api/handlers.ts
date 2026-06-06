// Shared API logic used by BOTH the local Express dev server (server.ts)
// and the Netlify serverless functions (netlify/functions/*).
//
// Each handler is framework-agnostic: it takes a parsed request body and
// returns { status, body }. Keys are read from process.env at call time
// (loaded by dotenv locally, injected by Netlify in production).

import { GoogleGenAI } from "@google/genai";

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

// The frontend wraps prompts in A1111/Stable-Diffusion emphasis syntax like
// `((subject):1.5)`. FLUX (and DALL-E / Gemini) expect plain natural language —
// FLUX in particular renders a BLACK image when given that syntax. Strip it so a
// usable prompt reaches the generator even if LLM sanitization is unavailable.
export function stripEmphasisSyntax(p: string): string {
  return p
    .replace(/:\s*\d+(\.\d+)?\s*(?=[)\]])/g, "") // remove weight like :1.5 before ) or ]
    .replace(/[()[\]]/g, " ")                     // drop emphasis brackets
    .replace(/\s+([,.])/g, "$1")                  // tidy spaces before punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// NVIDIA's FLUX safety filter signals a blocked prompt by returning a solid black
// frame, which compresses to a tiny JPEG (~5-7KB at 1024x1024); real generations are
// far larger (typically >40KB). We use that size gap to detect the filtered case.
export function isLikelyFilteredImage(base64: string): boolean {
  const bytes = Math.floor((base64.length * 3) / 4);
  return bytes > 0 && bytes < 12 * 1024;
}

interface ProviderDetails {
  apiKey: string;
  isOpenAI: boolean;
}

function getApiKeyAndProvider(): ProviderDetails | null {
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();

  const hasOpenAI = openAIKey !== undefined && openAIKey !== "undefined" && openAIKey !== "";
  const hasNvidia = nvidiaKey !== undefined && nvidiaKey !== "undefined" && nvidiaKey !== "";

  // 1. Explicit prefix checks (highly reliable)
  if (hasNvidia && nvidiaKey!.startsWith("nvapi-")) {
    return { apiKey: nvidiaKey!, isOpenAI: false };
  }
  if (hasOpenAI && openAIKey!.startsWith("nvapi-")) {
    return { apiKey: openAIKey!, isOpenAI: false };
  }
  if (hasOpenAI && openAIKey!.startsWith("sk-")) {
    return { apiKey: openAIKey!, isOpenAI: true };
  }
  if (hasNvidia && nvidiaKey!.startsWith("sk-")) {
    return { apiKey: nvidiaKey!, isOpenAI: true };
  }

  // 2. Variable-name based fallbacks if no known prefixes match
  if (hasOpenAI) {
    return { apiKey: openAIKey!, isOpenAI: true };
  }
  if (hasNvidia) {
    return { apiKey: nvidiaKey!, isOpenAI: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 1. Scene description generation with resilient multi-provider fallback
// ---------------------------------------------------------------------------
export async function handleGenerateDescription(input: {
  prompt?: string;
  provider?: string;
  model?: string;
  task?: string;
}): Promise<HandlerResult> {
  try {
    const { prompt, provider = "auto", model: requestedModel = "auto", task = "generate" } = input;
    if (!prompt) {
      return { status: 400, body: { error: "No prompt provided" } };
    }

    // The NVIDIA chat model used to enhance the prompt (honor the user's choice).
    const nvidiaChatModel =
      requestedModel && requestedModel !== "auto" ? requestedModel : "meta/llama-3.1-8b-instruct";

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

    const hasGemini = geminiKey && geminiKey.startsWith("AIzaSy");
    const hasOpenAI = openAIKey && openAIKey.startsWith("sk-");
    const hasNvidia = nvidiaKey && nvidiaKey.startsWith("nvapi-");

    let providerSequence: string[] = [];
    if (provider === "gemini") {
      providerSequence = ["gemini"];
    } else if (provider === "openai") {
      providerSequence = ["openai"];
    } else if (provider === "nvidia") {
      providerSequence = ["nvidia"];
    } else {
      providerSequence = [];
      if (hasGemini) providerSequence.push("gemini");
      if (hasOpenAI) providerSequence.push("openai");
      if (hasNvidia) providerSequence.push("nvidia");

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
        body: { error: "No API keys configured on the server. Please verify your environment variables." },
      };
    }

    let lastError: Error | null = null;
    let finalDescription = "";
    let finalProviderUsed = "";
    let finalModelUsed = "";

    for (const currentProvider of providerSequence) {
      try {
        console.log(`Attempting Scene Description using: ${currentProvider}...`);
        if (currentProvider === "gemini") {
          if (!geminiKey) throw new Error("No Gemini API Key defined in environment.");
          const aiClient = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } },
          });
          const response = await aiClient.models.generateContent({
            model: "gemini-3.5-flash",
            contents: `${systemInstruction}\n\nPROMPT: ${prompt}\n\nDESCRIPTION:`,
          });
          if (response.text) {
            finalDescription = response.text.trim();
            finalProviderUsed = "gemini";
            break;
          }
          throw new Error("Gemini returned an empty description response.");
        } else if (currentProvider === "openai") {
          const keyToUse = openAIKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No OpenAI API key found.");
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${keyToUse}`,
              "Content-Type": "application/json",
            },
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
            break;
          }
          throw new Error("OpenAI returned an empty description response.");
        } else if (currentProvider === "nvidia") {
          const keyToUse = nvidiaKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No NVIDIA API key found.");
          const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${keyToUse}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: nvidiaChatModel,
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: `PROMPT: ${prompt}\n\nDESCRIPTION:` },
              ],
              temperature: 0.7,
              max_tokens: 1024,
            }),
          });
          if (!response.ok) {
            throw new Error(`NVIDIA API returned status ${response.status}: ${await response.text()}`);
          }
          const data = (await response.json()) as any;
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            finalModelUsed = nvidiaChatModel;
          }
          if (content) {
            finalDescription = content;
            finalProviderUsed = "nvidia";
            break;
          }
          throw new Error("NVIDIA model returned an empty description response.");
        }
      } catch (err: any) {
        console.error(`Provider ${currentProvider} failed in Scene Description:`, err.message);
        lastError = err;
      }
    }

    if (!finalDescription) {
      throw lastError || new Error("Failed to generate description with any configured provider.");
    }

    return { status: 200, body: { description: finalDescription, provider: finalProviderUsed, model: finalModelUsed } };
  } catch (error: any) {
    console.error("Error in handleGenerateDescription:", error);
    return { status: 500, body: { error: error.message || "Failed to generate description" } };
  }
}

// ---------------------------------------------------------------------------
// 2. Image generation with sanitization & multi-provider fallback
// ---------------------------------------------------------------------------
// FLUX-accepted dimensions per aspect ratio (all verified working on this account).
const ASPECT_DIMS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "3:2": [1216, 832],
  "3:4": [896, 1152],
};

export async function handleGenerateImage(input: {
  prompt?: string;
  provider?: string;
  model?: string;
  aspectRatio?: string;
  seed?: number;
}): Promise<HandlerResult> {
  try {
    const { prompt, provider = "auto", model: requestedModel = "auto", aspectRatio = "1:1", seed } = input;
    const [imgWidth, imgHeight] = ASPECT_DIMS[aspectRatio] || ASPECT_DIMS["1:1"];
    if (!prompt) {
      return { status: 400, body: { error: "No prompt provided" } };
    }

    // Parse negative prompt if defined with " --no "
    let mainPrompt = prompt;
    let negativePrompt = "";
    const negativeIndex = prompt.indexOf(" --no ");
    if (negativeIndex !== -1) {
      mainPrompt = prompt.substring(0, negativeIndex);
      negativePrompt = prompt.substring(negativeIndex + 6);
    }

    const openAIKey = process.env.OPENAI_API_KEY?.trim();
    const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    const hasGemini = geminiKey && geminiKey.startsWith("AIzaSy");
    const hasOpenAI = openAIKey && openAIKey.startsWith("sk-");
    const hasNvidia = nvidiaKey && nvidiaKey.startsWith("nvapi-");

    // This is an SFW tool — there is no censoring step. We only strip any
    // Stable-Diffusion emphasis syntax (e.g. ((subject):1.5)) the builder may add,
    // since FLUX / DALL-E / Gemini expect plain natural language, then send as-is.
    const sanitizedPrompt = stripEmphasisSyntax(mainPrompt);

    console.log("Final prompt to send to image generator:", sanitizedPrompt);

    // 2.2 Image Generative Fallback Pipeline
    let imageSequence: string[] = [];
    if (provider === "gemini") {
      imageSequence = ["gemini"];
    } else if (provider === "openai") {
      imageSequence = ["openai"];
    } else if (provider === "nvidia") {
      imageSequence = ["nvidia"];
    } else {
      imageSequence = [];
      if (hasGemini) imageSequence.push("gemini");
      if (hasOpenAI) imageSequence.push("openai");
      if (hasNvidia) imageSequence.push("nvidia");

      if (imageSequence.length === 0) {
        const testObj = getApiKeyAndProvider();
        if (testObj) {
          imageSequence.push(testObj.isOpenAI ? "openai" : "nvidia");
        }
        if (geminiKey) {
          imageSequence.push("gemini");
        }
      }
    }

    let base64Image: string | null = null;
    let lastImageError: Error | null = null;
    let finalImageProviderUsed = "";
    let finalImageModelUsed = "";

    for (const currentImgProv of imageSequence) {
      try {
        console.log(`Attempting Image Generation using: ${currentImgProv}...`);
        if (currentImgProv === "gemini") {
          if (!geminiKey) throw new Error("No Gemini API Key defined in environment.");
          const aiClient = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } },
          });

          const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash-image",
            // The Content object MUST carry an explicit role, or the API rejects it
            // with "Please use a valid role: user, model." (string contents are
            // auto-wrapped as a user turn, but the object/array form is not).
            contents: [{ role: "user", parts: [{ text: sanitizedPrompt }] }],
            config: { imageConfig: { aspectRatio: "1:1" } },
          });

          const parts = response.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
              base64Image = part.inlineData.data;
              break;
            }
          }

          if (base64Image) {
            finalImageProviderUsed = "gemini";
            break;
          }

          let refusalText = "";
          for (const part of parts) {
            if (part.text) refusalText += part.text + " ";
          }
          if (refusalText.trim()) {
            throw new Error(`Gemini generated content but refused to produce image asset. Response: "${refusalText.trim()}"`);
          } else {
            throw new Error("Gemini completed successfully but did not produce any valid inline image parts.");
          }
        } else if (currentImgProv === "openai") {
          const keyToUse = openAIKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No OpenAI API key found.");
          const openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${keyToUse}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "dall-e-3",
              prompt: sanitizedPrompt,
              n: 1,
              size: "1024x1024",
              response_format: "b64_json",
            }),
          });

          if (!openaiRes.ok) {
            throw new Error(`OpenAI DALL-E 3 returned status ${openaiRes.status}: ${await openaiRes.text()}`);
          }

          const resJson = (await openaiRes.json()) as any;
          if (resJson.data && resJson.data[0] && typeof resJson.data[0].b64_json === "string") {
            base64Image = resJson.data[0].b64_json;
            finalImageProviderUsed = "openai";
            break;
          } else if (resJson.data && resJson.data[0] && typeof resJson.data[0].url === "string") {
            const imgRes = await fetch(resJson.data[0].url);
            if (imgRes.ok) {
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              base64Image = buffer.toString("base64");
              finalImageProviderUsed = "openai";
              break;
            }
          }
          throw new Error("Unable to extract valid visual buffer from OpenAI response payload.");
        } else if (currentImgProv === "nvidia") {
          const keyToUse = nvidiaKey || getApiKeyAndProvider()?.apiKey;
          if (!keyToUse) throw new Error("No NVIDIA API key found.");

          // This account is licensed for Black Forest Labs FLUX (verified working),
          // NOT the Stability SD/SDXL NIMs — those return 404 "Not found for account".
          // FLUX rejects `negative_prompt` ("extra_forbidden"). flux.1-schnell is
          // guidance-distilled so cfg_scale MUST be 0; flux.1-dev uses cfg_scale ~3.5.
          //
          // Only these two FLUX models are available to this account (verified).
          // flux.1-schnell is guidance-distilled (cfg_scale MUST be 0); flux.1-dev
          // uses cfg_scale ~3.5. NVIDIA_IMAGE_STEPS tunes flux.1-dev step count.
          const VALID_FLUX = ["flux.1-schnell", "flux.1-dev"];
          const normalize = (m: string) => (m.includes("/") ? m.split("/").pop()! : m).trim();
          const devSteps = Number(process.env.NVIDIA_IMAGE_STEPS) || 30;

          const callFlux = (model: string) => {
            const isSchnell = model.includes("schnell");
            return fetch(`https://ai.api.nvidia.com/v1/genai/black-forest-labs/${model}`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${keyToUse}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: sanitizedPrompt,
                mode: "base",
                cfg_scale: isSchnell ? 0 : 3.5,
                width: imgWidth,
                height: imgHeight,
                steps: isSchnell ? 4 : devSteps,
                ...(typeof seed === "number" ? { seed } : {}),
              }),
            });
          };

          // Honor the exact model the user picked. Only "auto" falls back between models.
          const picked = normalize(requestedModel || "auto");
          const modelsToTry = VALID_FLUX.includes(picked)
            ? [picked]
            : ["flux.1-schnell", "flux.1-dev"]; // auto: fast first, then quality

          let imageRes: Response | null = null;
          let usedFluxModel = "";
          for (const fluxModel of modelsToTry) {
            usedFluxModel = fluxModel;
            imageRes = await callFlux(fluxModel);
            if (imageRes.ok) break;
            const errorMsg = await imageRes.text();
            console.warn(`Nvidia ${fluxModel} failed (status ${imageRes.status}).`, errorMsg);
          }
          if (!imageRes) throw new Error("No NVIDIA image model was attempted.");

          if (!imageRes.ok) {
            throw new Error(`NVIDIA FLUX returned status ${imageRes.status}: ${await imageRes.text()}`);
          }

          const resJson = (await imageRes.json()) as any;
          if (resJson.artifacts && resJson.artifacts[0] && typeof resJson.artifacts[0].base64 === "string") {
            base64Image = resJson.artifacts[0].base64;
          } else if (typeof resJson.image === "string") {
            base64Image = resJson.image;
          } else if (resJson.data && resJson.data[0] && typeof resJson.data[0].b64_json === "string") {
            base64Image = resJson.data[0].b64_json;
          } else if (typeof resJson.b64_json === "string") {
            base64Image = resJson.b64_json;
          }

          if (base64Image) {
            // FLUX returns a black frame when its safety filter blocks the prompt.
            // Discard it and surface a clear, actionable error instead of a black box.
            if (isLikelyFilteredImage(base64Image)) {
              base64Image = null;
              throw new Error(
                "NVIDIA's safety filter blocked this image — the prompt was flagged as explicit and it returned a black frame. Soften the prompt (remove nudity/explicit and suggestive terms), or use an image provider that permits adult content.",
              );
            }
            finalImageProviderUsed = "nvidia";
            finalImageModelUsed = usedFluxModel;
            break;
          }
          throw new Error("Unable to parse a valid base64 image representation from NVIDIA's response.");
        }
      } catch (err: any) {
        console.error(`Image generator ${currentImgProv} failed:`, err.message);
        lastImageError = err;
      }
    }

    if (!base64Image) {
      throw lastImageError || new Error("Failed to generate image under any available or requested provider.");
    }

    return {
      status: 200,
      body: { image: base64Image, sanitizedPrompt, provider: finalImageProviderUsed, model: finalImageModelUsed },
    };
  } catch (error: any) {
    console.error("Error in handleGenerateImage:", error);
    return { status: 500, body: { error: error.message || "Failed to generate image" } };
  }
}
