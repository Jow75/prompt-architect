// One time budget per request. Netlify terminates synchronous functions at ~30s
// (measured on this site), so every upstream call must fit inside what is left
// of this budget instead of carrying its own independent timeout.

export const REQUEST_BUDGET_MS = 25_000;

export interface Deadline {
  /** Milliseconds left in the budget (never negative). */
  remaining(): number;
  /** Abort signal for one upstream attempt: at most `capMs`, and never past the budget minus `reserveMs`. */
  signal(capMs: number, reserveMs?: number): AbortSignal;
}

export function createDeadline(totalMs: number = REQUEST_BUDGET_MS, startedAt: number = Date.now()): Deadline {
  const end = startedAt + totalMs;
  const remaining = () => Math.max(0, end - Date.now());
  return {
    remaining,
    signal: (capMs, reserveMs = 0) => AbortSignal.timeout(Math.max(1, Math.min(capMs, remaining() - reserveMs))),
  };
}
