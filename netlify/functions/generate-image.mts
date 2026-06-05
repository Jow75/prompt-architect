import type { Context } from "@netlify/functions";
import { handleGenerateImage } from "../../api/handlers";

// Netlify serverless function backing POST /api/generate-image.
// NOTE: image generation must complete within the function timeout (10s on the
// free plan, up to 26s on paid). The default NVIDIA model is flux.1-schnell
// (~2-4s) for exactly this reason — see api/handlers.ts.
export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { prompt?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await handleGenerateImage(body);
  return Response.json(result.body, { status: result.status });
};

// Reached at /api/generate-image via the rewrite rule in netlify.toml.
