import type { Context } from "@netlify/functions";
import { handleGenerateDescription } from "../../api/handlers";

// Netlify serverless function backing POST /api/generate-description.
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

  const result = await handleGenerateDescription(body);
  return Response.json(result.body, { status: result.status });
};

// Reached at /api/generate-description via the rewrite rule in netlify.toml.
