// Live smoke test: runs the real API handlers against NVIDIA with the key in
// .env.local and reports timings. It bypasses sign-in and quota (those run in
// the Netlify functions), and makes real provider calls.
//
//   npm run smoke            # 3 text enhancements + 2 images
//   npm run smoke -- --full  # also FLUX.1 Dev and the slower text models

import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), quiet: true } as any);
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true } as any);

const { handleGenerateDescription, handleGenerateImage } = await import("../api/handlers");
const { createDeadline, REQUEST_BUDGET_MS } = await import("../api/deadline");

const full = process.argv.includes("--full");
const log = console.log;
// Keep the handlers' own logging out of the report.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
const row = (name: string, ok: boolean, ms: number, detail: string) => {
  if (!ok) failures++;
  log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${String(ms).padStart(6)}ms  ${detail}`);
};

async function text(name: string, input: Record<string, unknown>) {
  const t0 = Date.now();
  const r = await handleGenerateDescription(input, { deadline: createDeadline() });
  const ms = Date.now() - t0;
  const d: string = r.body.description || "";
  const formatted = /PROMPT:/.test(d) && /NEGATIVE PROMPT:/.test(d) && /TIPS:/.test(d);
  row(
    name,
    r.status === 200 && formatted && ms < REQUEST_BUDGET_MS + 1500,
    ms,
    r.status === 200 ? `${r.body.model}, ${d.length} chars${formatted ? "" : ", MISSING SECTIONS"}` : `${r.status} ${r.body.error?.code}: ${r.body.error?.message}`
  );
}

async function image(name: string, input: Record<string, unknown>) {
  const t0 = Date.now();
  const r = await handleGenerateImage(input, { deadline: createDeadline() });
  const ms = Date.now() - t0;
  const b64: string = r.body.image || "";
  const isJpegOrPng = b64.startsWith("/9j/") || b64.startsWith("iVBOR");
  row(
    name,
    r.status === 200 && isJpegOrPng && ms < REQUEST_BUDGET_MS + 1500,
    ms,
    r.status === 200 ? `${r.body.model}, ${Math.round((b64.length * 0.75) / 1024)} KB` : `${r.status} ${r.body.error?.code}: ${r.body.error?.message}`
  );
}

const idea = "a young explorer on an ancient stone bridge over a jungle canyon, cinematic concept art, golden hour";

await text("enhance (auto)", { prompt: idea });
await text("enhance (auto, repeat)", { prompt: "a red fox in fresh snow, photorealistic" });
await text("edit prompt (auto)", { prompt: "turn this into a watercolor painting, keep the likeness", task: "edit" });
await image("image (auto, 1:1)", { prompt: idea, seed: 1 });
await image("image (auto, 16:9)", { prompt: idea, aspectRatio: "16:9", seed: 2 });

if (full) {
  await text("enhance (gpt-oss-20b)", { prompt: idea, model: "openai/gpt-oss-20b" });
  await text("enhance (llama-3.2-11b)", { prompt: idea, model: "meta/llama-3.2-11b-vision-instruct" });
  await image("image (flux.1-dev)", { prompt: idea, model: "flux.1-dev", seed: 3 });
}

// Requests the server must refuse without calling a provider.
const rejected = async (name: string, run: Promise<{ status: number }>, expected: number) => {
  const t0 = Date.now();
  const r = await run;
  row(name, r.status === expected, Date.now() - t0, `status ${r.status} (expected ${expected})`);
};
await rejected("empty prompt rejected", handleGenerateImage({ prompt: " " }), 400);
await rejected("retired model rejected", handleGenerateImage({ prompt: idea, model: "dall-e-3" }), 400);
await rejected("unknown text model rejected", handleGenerateDescription({ prompt: idea, model: "gemini-2.5-flash" }), 400);

log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
