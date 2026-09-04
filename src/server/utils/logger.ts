/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Redacting Server Logger
 * 
 * SECURITY DIRECTIVE:
 * Never log access tokens, refresh tokens, client secrets, passwords, or PII.
 */

const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'clientsecret',
  'client_secret',
  'password',
  'authorization',
  'bearer',
  'cookie',
  'encryptionkey',
  'encryption_key',
]);

function redactSensitiveData(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const logger = {
  info(message: string, context?: Record<string, unknown>): void {
    const time = new Date().toISOString();
    const ctx = context ? JSON.stringify(redactSensitiveData(context)) : '';
    console.log(`[${time}] [INFO] [UniCloud] ${message} ${ctx}`.trim());
  },

  warn(message: string, context?: Record<string, unknown>): void {
    const time = new Date().toISOString();
    const ctx = context ? JSON.stringify(redactSensitiveData(context)) : '';
    console.warn(`[${time}] [WARN] [UniCloud] ${message} ${ctx}`.trim());
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const time = new Date().toISOString();
    const errMsg = error instanceof Error ? error.stack || error.message : String(error || '');
    const ctx = context ? JSON.stringify(redactSensitiveData(context)) : '';
    console.error(`[${time}] [ERROR] [UniCloud] ${message} | ${errMsg} ${ctx}`.trim());
  },

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      const time = new Date().toISOString();
      const ctx = context ? JSON.stringify(redactSensitiveData(context)) : '';
      console.debug(`[${time}] [DEBUG] [UniCloud] ${message} ${ctx}`.trim());
    }
  },
};
