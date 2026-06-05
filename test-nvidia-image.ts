import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load the NVIDIA key the same way the server does.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const KEY = process.env.NVIDIA_API_KEY?.trim();

// Image models THIS account is licensed for (verified live):
//   ✅ black-forest-labs/flux.1-dev      (high quality)
//   ✅ black-forest-labs/flux.1-schnell  (fast, 4 steps)
//   ❌ stabilityai/stable-diffusion-*    -> 404 "Not found for account"
async function callFlux(model: string, prompt: string, steps: number) {
  const res = await fetch(`https://ai.api.nvidia.com/v1/genai/black-forest-labs/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    // FLUX rejects `negative_prompt` and needs steps >= 5 for flux.1-dev.
    body: JSON.stringify({ prompt, mode: "base", cfg_scale: 3.5, width: 1024, height: 1024, steps }),
  });
  return res;
}

async function run() {
  if (!KEY || !KEY.startsWith("nvapi-")) {
    console.error("No valid NVIDIA_API_KEY (nvapi-...) found in .env.local");
    process.exit(1);
  }

  const prompt = "A beautiful futuristic city at golden hour, cinematic photography, highly detailed";
  console.log("Requesting image from NVIDIA FLUX.1-dev...");

  let res = await callFlux("flux.1-dev", prompt, 40);
  let model = "flux.1-dev";
  if (!res.ok) {
    console.warn(`flux.1-dev failed (${res.status}): ${await res.text()}\nFalling back to flux.1-schnell...`);
    res = await callFlux("flux.1-schnell", prompt, 4);
    model = "flux.1-schnell";
  }

  if (!res.ok) {
    throw new Error(`NVIDIA FLUX returned status ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const b64: string | undefined = data?.artifacts?.[0]?.base64;
  if (!b64) {
    throw new Error("No base64 image in response: " + JSON.stringify(data).slice(0, 300));
  }

  const ext = b64.startsWith("/9j/") ? "jpg" : "png";
  const outFile = path.join(process.cwd(), `nvidia-flux-test.${ext}`);
  fs.writeFileSync(outFile, Buffer.from(b64, "base64"));
  console.log(`✅ Success via ${model}! Saved ${outFile} (${Math.round(b64.length * 0.75 / 1024)} KB)`);
}

run().catch((err) => {
  console.error("NVIDIA image test failed:", err.message);
  process.exit(1);
});
