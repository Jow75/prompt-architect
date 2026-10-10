import { createDeadline } from "./deadline";
import { verifyAuth } from "./auth";
import { checkRateLimit, reserveDailyQuota, isAllowedOrigin } from "./access";
import type { HandlerContext, HandlerResult, Validated } from "./handlers";

// Shared request pipeline for the Netlify functions:
//   method -> origin -> auth -> parse + validate -> hourly cap -> daily quota -> handler.
// Input is validated BEFORE quota is reserved, and the reserved unit is given
// back when the request produced nothing, so failures never cost the user quota.

export interface GuardedRoute<T> {
  route: string;
  namespace: string;
  hourlyLimit: number;
  dailyLimit: number;
  validate: (body: any) => Validated<T>;
  handle: (input: T, ctx: HandlerContext) => Promise<HandlerResult>;
}

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ success: false, error: { code, message } }, { status });

export async function runGuarded<T>(
  req: Request,
  context: { ip?: string; requestId?: string },
  opts: GuardedRoute<T>
): Promise<Response> {
  const started = Date.now();
  const deadline = createDeadline(undefined, started);
  const timings: Record<string, number> = {};
  const finish = (response: Response, extra: Record<string, unknown> = {}) => {
    // One structured line per request; never contains tokens, keys or prompt text.
    console.log(
      JSON.stringify({
        rid: context.requestId ?? null,
        route: opts.route,
        status: response.status,
        ms: { ...timings, total: Date.now() - started },
        ...extra,
      })
    );
    return response;
  };

  if (req.method !== "POST") return finish(errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
  if (!isAllowedOrigin(req)) return finish(errorResponse(403, "FORBIDDEN", "Origin not allowed"));

  let mark = Date.now();
  const authResult = await verifyAuth(req);
  timings.auth = Date.now() - mark;
  if (authResult.success === false) {
    const { status, code, message } = authResult.error;
    return finish(errorResponse(status, code, message), { code });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return finish(errorResponse(400, "INVALID_INPUT", "Invalid JSON request body"));
  }
  const validated = opts.validate(body);
  if (validated.ok === false) {
    return finish(Response.json(validated.result.body, { status: validated.result.status }), { code: "INVALID_INPUT" });
  }

  mark = Date.now();
  const rl = await checkRateLimit(context.ip, opts.namespace, opts.hourlyLimit);
  if (!rl.ok) {
    timings.quota = Date.now() - mark;
    return finish(errorResponse(rl.status ?? 429, "RATE_LIMITED", rl.message ?? "Hourly limit reached. Please try again later."));
  }
  const quota = await reserveDailyQuota(authResult.user.id, opts.namespace, opts.dailyLimit);
  timings.quota = Date.now() - mark;
  if (!quota.ok) {
    return finish(errorResponse(quota.status ?? 429, "QUOTA_EXCEEDED", quota.message ?? "Daily quota reached. Resets at UTC midnight."));
  }

  mark = Date.now();
  const result = await opts.handle(validated.value, { deadline });
  timings.provider = Date.now() - mark;

  // Keep the charge for successes and for safety rejections (the provider did
  // the work); refund everything else.
  if (result.status !== 200 && result.status !== 422) {
    await quota.release();
  }

  return finish(Response.json(result.body, { status: result.status }), {
    code: result.body?.error?.code,
    model: result.body?.model,
  });
}
