import './setup';
import { isTransientHttpError, retryWithBackoff, HttpError } from '../lib/marketplaces/fetch';

describe('isTransientHttpError', () => {
  it('treats 429 and 5xx as transient', () => {
    expect(isTransientHttpError(new HttpError(429, 'rate limited'))).toBe(true);
    expect(isTransientHttpError(new HttpError(503, 'down'))).toBe(true);
  });

  it('treats 4xx (non-429) as permanent', () => {
    expect(isTransientHttpError(new HttpError(400, 'bad'))).toBe(false);
    expect(isTransientHttpError(new HttpError(401, 'no'))).toBe(false);
  });

  it('matches network-style errors by message', () => {
    expect(isTransientHttpError(new Error('fetch failed'))).toBe(true);
    expect(isTransientHttpError(new Error('ECONNRESET while reading'))).toBe(true);
    expect(isTransientHttpError(new Error('totally unrelated'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTransientHttpError('string')).toBe(false);
    expect(isTransientHttpError(undefined)).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  it('returns immediately on success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient errors then succeeds', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError(503, 'flaky');
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry permanent errors', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new HttpError(400, 'bad');
        },
        { maxAttempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('bad');
    expect(calls).toBe(1);
  });

  it('gives up after maxAttempts', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new HttpError(502, 'flaky');
        },
        { maxAttempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(2);
  });
});
