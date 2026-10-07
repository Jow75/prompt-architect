// Client-side service layer for Prompt Architect generation APIs.
// Handles authentication headers, auto token refresh, structured error parsing, and retry logic.

import { getValidAccessToken, isUserSignedIn } from './supabase';
import {
  AuthRequiredError,
  TokenExpiredError,
  RateLimitError,
  QuotaExceededError,
  SafetyViolationError,
  ProviderUnavailableError,
  ServerConfigError,
  NetworkError,
  PromptArchitectError,
} from './errors';

async function buildAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const token = await getValidAccessToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Parses JSON error payload and returns appropriate typed error.
 */
function parseApiError(status: number, data: any): Error {
  const errObj = data?.error;
  const code = typeof errObj === 'object' ? errObj?.code : undefined;
  const message = (typeof errObj === 'object' ? errObj?.message : errObj) || data?.message;

  if (status === 401) {
    if (code === 'TOKEN_EXPIRED') {
      return new TokenExpiredError(message || 'Your session has expired. Please refresh or sign in again.');
    }
    return new AuthRequiredError(message || 'Please sign in to use this feature.');
  }

  if (status === 429) {
    if (code === 'QUOTA_EXCEEDED') {
      return new QuotaExceededError(message || 'You have reached your daily generation quota.');
    }
    return new RateLimitError(message || "You've reached the current rate limit. Please try again later.");
  }

  if (status === 422 || code === 'SAFETY_VIOLATION') {
    return new SafetyViolationError(message || 'The prompt triggered content safety restrictions.');
  }

  if (status === 503 || code === 'PROVIDER_UNAVAILABLE') {
    return new ProviderUnavailableError(message || 'The AI generation provider is temporarily unavailable.');
  }

  if (status === 500 && code === 'SERVER_CONFIG_ERROR') {
    return new ServerConfigError(message || 'Server configuration error. Please contact support.');
  }

  return new PromptArchitectError(
    message || `Server responded with status ${status}`,
    code || 'INTERNAL_ERROR',
    status
  );
}

/**
 * Generic fetch wrapper with automatic JWT refresh retry on TOKEN_EXPIRED.
 */
async function authedApiRequest<T>(
  url: string,
  body: Record<string, any>,
  onProgress?: (status: string) => void
): Promise<T> {
  // Check signed-in state before making network call
  const signedIn = await isUserSignedIn();
  if (!signedIn) {
    throw new AuthRequiredError('Please sign in to use this feature.');
  }

  if (onProgress) onProgress('Authenticating...');
  let headers = await buildAuthHeaders(false);

  // If no token despite user being signed in, attempt proactive refresh
  if (!headers.Authorization) {
    headers = await buildAuthHeaders(true);
  }

  if (!headers.Authorization) {
    throw new AuthRequiredError('Your session has expired. Please sign in again.');
  }

  if (onProgress) onProgress('Sending request...');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (netErr: any) {
    console.error(`[API] Network error while calling ${url}:`, netErr);
    throw new NetworkError('Unable to reach the server. Please check your internet connection.');
  }

  // Handle Token Expired with automatic single retry
  if (response.status === 401) {
    const errData = await response.json().catch(() => ({}));
    const code = errData?.error?.code;

    if (code === 'TOKEN_EXPIRED') {
      console.log('[API] Received TOKEN_EXPIRED. Attempting session refresh and retry...');
      if (onProgress) onProgress('Refreshing authentication session...');

      const refreshedHeaders = await buildAuthHeaders(true);
      if (refreshedHeaders.Authorization) {
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: refreshedHeaders,
            body: JSON.stringify(body),
          });
        } catch {
          throw new NetworkError('Connection interrupted during request retry.');
        }
      }
    } else {
      throw parseApiError(response.status, errData);
    }
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw parseApiError(response.status, errData);
  }

  const data = await response.json();
  return data;
}

export async function generateVividDescription(
  prompt: string,
  model: string = 'auto',
  task: 'generate' | 'edit' = 'generate',
  provider: string = 'auto',
  onProgress?: (stage: string) => void
): Promise<{ description: string; provider: string; model: string }> {
  try {
    if (onProgress) onProgress('Preparing prompt...');
    const data = await authedApiRequest<any>(
      '/api/generate-description',
      { prompt, provider, model, task },
      onProgress
    );

    return {
      description: data.description,
      provider: data.provider || 'nvidia',
      model: data.model || '',
    };
  } catch (error: any) {
    console.error('[API] Error in generateVividDescription:', error);
    throw error;
  }
}

export async function generateImage(
  prompt: string,
  model: string = 'auto',
  aspectRatio: string = '1:1',
  seed?: number,
  provider: string = 'auto',
  onProgress?: (stage: string) => void
): Promise<{ image: string; sanitizedPrompt: string; provider: string; model: string }> {
  try {
    if (onProgress) onProgress('Preparing prompt...');
    const data = await authedApiRequest<any>(
      '/api/generate-image',
      { prompt, provider, model, aspectRatio, seed },
      onProgress
    );

    return {
      image: data.image,
      sanitizedPrompt: data.sanitizedPrompt,
      provider: data.provider || 'nvidia',
      model: data.model || '',
    };
  } catch (error: any) {
    console.error('[API] Error in generateImage:', error);
    throw error;
  }
}
