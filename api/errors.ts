// Server-side classification of upstream provider failures. The kind decides the
// HTTP status sent to the client and whether an attempt may be retried.

export type ProviderErrorKind =
  | "safety" // provider content filter rejected the prompt
  | "client" // provider rejected the request parameters
  | "config" // API key missing or rejected
  | "rate_limited" // provider returned 429
  | "timeout" // attempt exceeded its time budget
  | "unavailable"; // 5xx, network failure, or unusable response

export class ProviderError extends Error {
  public readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && (err.kind === "unavailable" || err.kind === "timeout" || err.kind === "rate_limited");
}

export function isAbortError(err: unknown): boolean {
  const name = (err as any)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Maps a failure to the response the API handlers return. */
export function toErrorResponse(err: unknown, fallbackMessage: string): { status: number; code: string; message: string } {
  if (err instanceof ProviderError) {
    switch (err.kind) {
      case "safety":
        return { status: 422, code: "SAFETY_VIOLATION", message: err.message };
      case "client":
        return { status: 400, code: "INVALID_INPUT", message: err.message };
      case "config":
        return { status: 500, code: "SERVER_CONFIG_ERROR", message: err.message };
      case "rate_limited":
        return { status: 429, code: "RATE_LIMITED", message: err.message };
      default:
        return { status: 503, code: "PROVIDER_UNAVAILABLE", message: err.message };
    }
  }
  return { status: 503, code: "PROVIDER_UNAVAILABLE", message: fallbackMessage };
}
