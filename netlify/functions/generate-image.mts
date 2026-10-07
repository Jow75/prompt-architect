import type { Context } from "@netlify/functions";
import { handleGenerateImage } from "../../api/handlers";
import { checkRateLimit, checkDailyQuota, isAllowedOrigin } from "../../api/access";
import { verifyAuth } from "../../api/auth";

// Netlify serverless function backing POST /api/generate-image.
export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json(
      { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } },
      { status: 405 }
    );
  }

  if (!isAllowedOrigin(req)) {
    return Response.json(
      { success: false, error: { code: "FORBIDDEN", message: "Origin not allowed" } },
      { status: 403 }
    );
  }

  const authResult = await verifyAuth(req);
  if (!authResult.success) {
    const authErr = authResult.error || { code: "AUTH_REQUIRED", message: "Unauthorized", status: 401 };
    return Response.json(
      { success: false, error: authErr },
      { status: authErr.status }
    );
  }

  const user = authResult.user;
  const rl = await checkRateLimit(context.ip, "img", 40);
  if (!rl.ok) {
    return Response.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: rl.message ?? "Hourly limit reached. Please try again later." },
      },
      { status: rl.status ?? 429 }
    );
  }

  const quota = await checkDailyQuota(user.id, "img", 30);
  if (!quota.ok) {
    return Response.json(
      {
        success: false,
        error: { code: "QUOTA_EXCEEDED", message: quota.message ?? "Daily quota reached. Resets at UTC midnight." },
      },
      { status: quota.status ?? 429 }
    );
  }

  let body: {
    prompt?: string;
    provider?: string;
    model?: string;
    aspectRatio?: string;
    seed?: number;
    width?: number;
    height?: number;
  } = {};

  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Invalid JSON request body" } },
      { status: 400 }
    );
  }

  const result = await handleGenerateImage(body);
  return Response.json(result.body, { status: result.status });
};
