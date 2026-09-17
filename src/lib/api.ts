/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Client API Utility
 * 
 * Provides an authenticated fetch wrapper using standard HTTP-only session cookies
 * with automatic credentials inclusion. Raw session tokens are never stored in
 * localStorage or exposed to browser JavaScript.
 */

const LEGACY_STORAGE_KEYS = ['unicloud_session_token', 'sessionToken'];

/**
 * Purge any legacy session tokens from browser web storage (localStorage & sessionStorage)
 * to ensure tokens never reside in client-side storage.
 */
export function clearSessionToken(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access restrictions in sandboxed iframes
  }
}

/**
 * Authenticated fetch wrapper for UniCloud client.
 * Uses HTTP-only cookie authentication via credentials: 'include'.
 * Does not expose or transmit raw session tokens via Bearer headers in normal browser operations.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'include',
  });
}

export interface SafeApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: {
    code?: string;
    message: string;
    details?: Record<string, unknown>;
  };
  rawText?: string;
}

/**
 * Safely parse API response without throwing SyntaxError on non-JSON content.
 * Preserves the actual HTTP status code and meaningful error message.
 */
export async function parseApiResponse<T = any>(res: Response): Promise<SafeApiResponse<T>> {
  let json: any = null;
  let rawText = '';

  try {
    rawText = await res.text();
    if (rawText && rawText.trim()) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }
  } catch {
    rawText = '';
  }

  if (json && typeof json === 'object') {
    const isSuccess = res.ok && json.success !== false;
    return {
      ok: isSuccess,
      status: res.status,
      data: json.data,
      error: json.error || (isSuccess ? undefined : { message: `Request failed with status ${res.status}` }),
      rawText,
    };
  }

  const safeSnippet = rawText ? rawText.replace(/<[^>]*>?/gm, '').trim().slice(0, 250) : '';
  const fallbackMessage = safeSnippet
    ? `Server error (${res.status}): ${safeSnippet}`
    : `Server returned HTTP ${res.status} (${res.statusText || 'Error'})`;

  return {
    ok: false,
    status: res.status,
    error: {
      message: fallbackMessage,
    },
    rawText,
  };
}
