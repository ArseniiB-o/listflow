/**
 * lib/marketplaces/fetch.ts
 *
 * Shared HTTP helpers for all marketplace adapters:
 *   - fetchWithTimeout: abort after N ms
 *   - retryWithBackoff: exponential retry for transient (5xx, 429) errors
 */

import 'server-only';

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isTransientHttpError(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status === 429 || (err.status >= 500 && err.status < 600);
  }
  if (err instanceof Error) {
    return /abort|timeout|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message);
  }
  return false;
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const isRetryable = opts.isRetryable ?? isTransientHttpError;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) break;
      const jitter = Math.random() * baseDelayMs;
      const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
