import type { Context } from "@netlify/functions";
import { handleGenerateDescription } from "../../api/handlers";
import { checkRateLimit, isAllowedOrigin } from "../../api/access";

// Netlify serverless function backing POST /api/generate-description.
export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!isAllowedOrigin(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const rl = await checkRateLimit(context.ip, "txt", 80);
  if (!rl.ok) {
    return Response.json({ error: rl.message ?? "Rate limited" }, { status: rl.status ?? 429 });
  }

  let body: { prompt?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await handleGenerateDescription(body);
  return Response.json(result.body, { status: result.status });
};

// Reached at /api/generate-description via the rewrite rule in netlify.toml.
