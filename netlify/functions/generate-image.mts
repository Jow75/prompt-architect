import type { Context } from "@netlify/functions";
import { handleGenerateImage, validateImageInput } from "../../api/handlers";
import { runGuarded } from "../../api/guard";

// Netlify serverless function backing POST /api/generate-image.
export default async (req: Request, context: Context): Promise<Response> =>
  runGuarded(req, context, {
    route: "generate-image",
    namespace: "img",
    hourlyLimit: 40,
    dailyLimit: 30,
    validate: validateImageInput,
    handle: handleGenerateImage,
  });
