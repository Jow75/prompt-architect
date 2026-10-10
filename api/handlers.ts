import { providerRegistry } from "./providers/registry";
import { ASPECT_RATIO_DIMENSIONS } from "./providers/nvidia";
import { createDeadline, type Deadline } from "./deadline";
import { ProviderError, isAbortError, toErrorResponse } from "./errors";

export interface HandlerResult {
  status: number;
  body: Record<string, any>;
}

export interface HandlerContext {
  /** Shared time budget for the whole request (auth and quota time already spent). */
  deadline?: Deadline;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; result: HandlerResult };

const MAX_PROMPT_CHARS = 4000;

const invalid = (message: string): { ok: false; result: HandlerResult } => ({
  ok: false,
  result: { status: 400, body: { success: false, error: { code: "INVALID_INPUT", message } } },
});

function validatePrompt(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

// ---------------------------------------------------------------------------
// 1. Text Enhancement / Scene Description
// ---------------------------------------------------------------------------

// Text models the server will call, with the extra request fields each needs to
// answer quickly. Timings are from this account: Nemotron 3 Super with thinking
// off answers in ~2-3s; GPT-OSS 20B at low effort in ~10-17s; Llama 3.2 11B in
// ~10-28s (kept as a manual choice only).
const TEXT_MODELS: Record<string, Record<string, unknown>> = {
  "nvidia/nemotron-3-super-120b-a12b": { chat_template_kwargs: { enable_thinking: false } },
  "openai/gpt-oss-20b": { reasoning_effort: "low" },
  "meta/llama-3.2-11b-vision-instruct": {},
};
const AUTO_TEXT_CHAIN = ["nvidia/nemotron-3-super-120b-a12b", "openai/gpt-oss-20b"];
// If the first model has not answered by now, start the next one alongside it.
const HEDGE_DELAY_MS = 6_000;

export interface DescriptionInput {
  prompt: string;
  model: string;
  task: "generate" | "edit";
}

export function validateDescriptionInput(input: any): Validated<DescriptionInput> {
  const prompt = validatePrompt(input?.prompt);
  if (!prompt) return invalid("Prompt text is required.");
  if (prompt.length > MAX_PROMPT_CHARS) return invalid(`Prompt is too long (maximum ${MAX_PROMPT_CHARS} characters).`);

  const model = typeof input?.model === "string" && input.model ? input.model : "auto";
  if (model !== "auto" && !(model in TEXT_MODELS)) return invalid(`Unsupported text model '${model}'.`);

  return { ok: true, value: { prompt, model, task: input?.task === "edit" ? "edit" : "generate" } };
}

const GENERATE_INSTRUCTION = `You are a world-class AI image-prompt engineer (a senior concept artist + prompt specialist). The user gives you an idea, a photo description, or a partial prompt. Produce a complete, professional, ready-to-use prompt package.

PRESERVE the user's core subject, concept and intent — never replace their idea or add unrelated subjects.

Output EXACTLY these labeled sections, in plain text. Do NOT use markdown symbols like #, *, or backticks.

PROMPT:
<One polished, richly detailed, ready-to-paste image-generation prompt of roughly 60 to 120 words. Cover: subject specifics, composition and framing, setting/background, lighting, color palette, mood/atmosphere, art style or medium, and camera/lens or render quality. Be vivid and specific; front-load the most important elements. Keep it tasteful and safe-for-work.>

NEGATIVE PROMPT:
<A concise comma-separated list of things to avoid for this image, e.g. blurry, deformed hands, extra limbs, watermark, text.>

TIPS:
- <2 to 4 short, practical tips for getting the best result from this prompt.>

Do not add any other text, preamble, or explanation outside these three sections.`;

const EDIT_INSTRUCTION = `You are a world-class photo-editing prompt engineer. The user wants to transform an EXISTING reference photo. Produce a complete, professional editing prompt package.

By DEFAULT preserve the subject's identity — the same face and facial features, hairstyle, body proportions, skin tone, pose, and background — and change ONLY what the user's instruction asks for. Apply exactly the transformation they describe.

Output EXACTLY these labeled sections, in plain text. Do NOT use markdown symbols like #, *, or backticks.

PROMPT:
<One polished, ready-to-paste editing prompt of roughly 60 to 120 words, directed at an image editor/model. Refer to "the provided photo". Clearly state the transformation, what to preserve (identity and key features), the target style, lighting, level of detail, and output quality. Be specific. Keep it tasteful and safe-for-work.>

NEGATIVE PROMPT:
<A concise comma-separated list of things to avoid, e.g. different person, altered identity, distorted face, extra limbs, watermark, text.>

TIPS:
- <2 to 4 short, practical tips for a faithful edited result.>

Do not add any other text, preamble, or explanation outside these three sections.`;

async function callNvidiaChat(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal: AbortSignal
): Promise<string> {
  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        max_tokens: 700,
        ...TEXT_MODELS[model],
      }),
    });
  } catch (err: any) {
    if (isAbortError(err)) throw new ProviderError("timeout", "The text model took too long to respond. Please try again.");
    throw new ProviderError("unavailable", "Could not reach the text provider. Please try again.");
  }

  console.log(`[NVIDIA Chat] ${model} -> ${response.status} in ${Date.now() - t0}ms`);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.warn(`[NVIDIA Chat] ${model} error body:`, errText.slice(0, 300));
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("config", "The text provider rejected the server's API key.");
    }
    if (response.status === 429) {
      throw new ProviderError("rate_limited", "The text provider is rate-limiting requests. Please wait a moment and try again.");
    }
    throw new ProviderError("unavailable", "The text provider is temporarily unavailable. Please try again.");
  }

  let content = "";
  try {
    const data = (await response.json()) as any;
    content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (err: any) {
    if (isAbortError(err)) throw new ProviderError("timeout", "The text model took too long to respond. Please try again.");
    throw new ProviderError("unavailable", "The text provider returned an unreadable response.");
  }
  if (!content) throw new ProviderError("unavailable", "The text model returned an empty response. Please try again.");
  return content;
}

// Most actionable failure first, so the user sees the cause they can do something about.
const ERROR_PRIORITY = ["config", "rate_limited", "timeout", "unavailable"];

/**
 * Runs the models as a hedged race: the first starts immediately; the next
 * starts when the previous one fails, or after HEDGE_DELAY_MS if it is still
 * silent. The first usable answer wins and the others are cancelled.
 */
function raceChat(
  apiKey: string,
  models: string[],
  system: string,
  user: string,
  deadline: Deadline
): Promise<{ text: string; model: string }> {
  const cancel = new AbortController();
  const errors: ProviderError[] = [];

  return new Promise((resolve, reject) => {
    let next = 0;
    let pending = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const launch = () => {
      if (settled || next >= models.length) return;
      const model = models[next++];
      pending++;
      // Leave 1s of the request budget for sending the response.
      const signal = AbortSignal.any([cancel.signal, deadline.signal(24_000, 1000)]);

      callNvidiaChat(apiKey, model, system, user, signal).then(
        (text) => {
          if (settled) return;
          settled = true;
          clearTimeout(hedgeTimer);
          cancel.abort();
          resolve({ text, model });
        },
        (err) => {
          pending--;
          if (settled) return;
          errors.push(err instanceof ProviderError ? err : new ProviderError("unavailable", "The text provider failed."));
          if (next < models.length) {
            clearTimeout(hedgeTimer);
            launch();
          } else if (pending === 0) {
            settled = true;
            errors.sort((a, b) => ERROR_PRIORITY.indexOf(a.kind) - ERROR_PRIORITY.indexOf(b.kind));
            reject(errors[0]);
          }
        }
      );

      if (next < models.length) hedgeTimer = setTimeout(launch, HEDGE_DELAY_MS);
    };

    launch();
  });
}

export async function handleGenerateDescription(input: any, ctx: HandlerContext = {}): Promise<HandlerResult> {
  const validated = validateDescriptionInput(input);
  if (validated.ok === false) return validated.result;
  const { prompt, model, task } = validated.value;

  try {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();
    if (!apiKey || !apiKey.startsWith("nvapi-")) {
      throw new ProviderError("config", "No AI text generation key is configured on the server.");
    }

    const models = model === "auto" ? AUTO_TEXT_CHAIN : [model];
    const system = task === "edit" ? EDIT_INSTRUCTION : GENERATE_INSTRUCTION;
    const { text, model: modelUsed } = await raceChat(
      apiKey,
      models,
      system,
      `PROMPT: ${prompt}\n\nDESCRIPTION:`,
      ctx.deadline ?? createDeadline()
    );

    return { status: 200, body: { success: true, description: text, provider: "nvidia", model: modelUsed } };
  } catch (error: any) {
    console.error("Error in handleGenerateDescription:", error?.message);
    const { status, code, message } = toErrorResponse(error, "Failed to generate prompt description.");
    return { status, body: { success: false, error: { code, message } } };
  }
}

// ---------------------------------------------------------------------------
// 2. Image Generation via Provider Architecture
// ---------------------------------------------------------------------------

export interface ImageInput {
  prompt: string;
  model: string;
  aspectRatio: string;
  seed?: number;
}

export function validateImageInput(input: any): Validated<ImageInput> {
  const prompt = validatePrompt(input?.prompt);
  if (!prompt) return invalid("Prompt text is required.");
  if (prompt.length > MAX_PROMPT_CHARS) return invalid(`Prompt is too long (maximum ${MAX_PROMPT_CHARS} characters).`);

  const model = typeof input?.model === "string" && input.model ? input.model : "auto";
  if (model !== "auto" && !providerRegistry.getSupportedModels().includes(model)) {
    return invalid(`Unsupported image model '${model}'.`);
  }

  const aspectRatio = typeof input?.aspectRatio === "string" && input.aspectRatio ? input.aspectRatio : "1:1";
  if (!(aspectRatio in ASPECT_RATIO_DIMENSIONS)) return invalid(`Unsupported aspect ratio '${aspectRatio}'.`);

  let seed: number | undefined;
  if (input?.seed !== undefined && input.seed !== null) {
    if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4_294_967_295) {
      return invalid("Seed must be a whole number between 0 and 4294967295.");
    }
    seed = input.seed;
  }

  return { ok: true, value: { prompt, model, aspectRatio, seed } };
}

export async function handleGenerateImage(input: any, ctx: HandlerContext = {}): Promise<HandlerResult> {
  const validated = validateImageInput(input);
  if (validated.ok === false) return validated.result;
  const { prompt, model, aspectRatio, seed } = validated.value;

  try {
    const result = await providerRegistry.generateImage({
      prompt,
      model,
      aspectRatio,
      seed,
      deadline: ctx.deadline ?? createDeadline(),
    });

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
    console.error("Error in handleGenerateImage:", error?.message);
    const { status, code, message } = toErrorResponse(error, "Failed to generate image.");
    return { status, body: { success: false, error: { code, message } } };
  }
}
