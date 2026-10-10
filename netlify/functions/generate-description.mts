import type { Context } from "@netlify/functions";
import { handleGenerateDescription, validateDescriptionInput } from "../../api/handlers";
import { runGuarded } from "../../api/guard";

// Netlify serverless function backing POST /api/generate-description.
export default async (req: Request, context: Context): Promise<Response> =>
  runGuarded(req, context, {
    route: "generate-description",
    namespace: "txt",
    hourlyLimit: 80,
    dailyLimit: 60,
    validate: validateDescriptionInput,
    handle: handleGenerateDescription,
  });
