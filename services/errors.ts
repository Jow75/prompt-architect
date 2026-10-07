// Standard error classification for Prompt Architect API & client services

export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'SAFETY_VIOLATION'
  | 'INVALID_INPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'SERVER_CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

export class PromptArchitectError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, code: ApiErrorCode, status: number = 500, details?: unknown) {
    super(message);
    this.name = 'PromptArchitectError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthRequiredError extends PromptArchitectError {
  constructor(message = 'Please sign in to use this feature.') {
    super(message, 'AUTH_REQUIRED', 401);
    this.name = 'AuthRequiredError';
  }
}

export class TokenExpiredError extends PromptArchitectError {
  constructor(message = 'Your session has expired. Please refresh or sign in again.') {
    super(message, 'TOKEN_EXPIRED', 401);
    this.name = 'TokenExpiredError';
  }
}

export class RateLimitError extends PromptArchitectError {
  constructor(message = "You've reached the current rate limit. Please try again later.") {
    super(message, 'RATE_LIMITED', 429);
    this.name = 'RateLimitError';
  }
}

export class QuotaExceededError extends PromptArchitectError {
  constructor(message = 'You have reached your daily generation quota.') {
    super(message, 'QUOTA_EXCEEDED', 429);
    this.name = 'QuotaExceededError';
  }
}

export class SafetyViolationError extends PromptArchitectError {
  constructor(message = "Content safety filter blocked this request. Please adjust your prompt wording.") {
    super(message, 'SAFETY_VIOLATION', 422);
    this.name = 'SafetyViolationError';
  }
}

export class ProviderUnavailableError extends PromptArchitectError {
  constructor(message = 'The AI generation provider is temporarily unavailable. Please try again in a moment.') {
    super(message, 'PROVIDER_UNAVAILABLE', 503);
    this.name = 'ProviderUnavailableError';
  }
}

export class ServerConfigError extends PromptArchitectError {
  constructor(message = 'Server configuration error. Please contact support.') {
    super(message, 'SERVER_CONFIG_ERROR', 500);
    this.name = 'ServerConfigError';
  }
}

export class NetworkError extends PromptArchitectError {
  constructor(message = 'Network error. Please check your internet connection and try again.') {
    super(message, 'NETWORK_ERROR', 0);
    this.name = 'NetworkError';
  }
}

/**
 * Maps raw API error response or caught exception into a friendly user-facing message
 */
export function formatUserFacingError(err: unknown): string {
  if (err instanceof PromptArchitectError) {
    return err.message;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('abort')) {
      return 'Network connection issue. Please verify your internet connection.';
    }
    return err.message;
  }
  return 'An unexpected error occurred. Please try again.';
}
