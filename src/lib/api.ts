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
