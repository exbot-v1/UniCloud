/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Client API Utility
 * 
 * Provides an authenticated fetch wrapper that handles dual-channel authentication
 * (HTTP-only cookies and Bearer token in Authorization header) to ensure seamless
 * authentication across standard browsers, cross-site iframes, and partitioned contexts.
 */

const TOKEN_STORAGE_KEY = 'unicloud_session_token';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore localStorage write failure in restricted environments
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore localStorage write failure in restricted environments
  }
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });
}
