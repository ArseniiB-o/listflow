/**
 * Unit tests for the AI content engine internals (pure functions only).
 */

process.env.NODE_ENV = 'test';
process.env.NEXTAUTH_SECRET = 'x'.repeat(32);
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
process.env.OPENROUTER_API_KEY = 'or-test';

import { __internal } from '../lib/ai/content-engine';

describe('effectiveTitleLimit', () => {
  it('takes the minimum across requested channels', () => {
    expect(__internal.effectiveTitleLimit(['ebay_de', 'etsy_de'])).toBe(80);
    expect(__internal.effectiveTitleLimit(['etsy_de'])).toBe(140);
    expect(__internal.effectiveTitleLimit(['self'])).toBe(120);
  });
});

describe('enforceLimits', () => {
  const baseContent = {
    title: { de: 'a'.repeat(200), en: 'b'.repeat(200) },
    description: { de: 'x', en: 'y' },
    tags: { de: ['a'], en: ['b'] },
    materialHints: [],
    suggestedCategoryPath: {},
  };

  it('truncates titles longer than the limit', () => {
    const out = __internal.enforceLimits(baseContent, 80);
    expect(out.title.de.length).toBeLessThanOrEqual(80);
    expect(out.title.en.length).toBeLessThanOrEqual(80);
    expect(out.title.de.endsWith('…')).toBe(true);
  });

  it('leaves short titles untouched', () => {
    const out = __internal.enforceLimits({ ...baseContent, title: { de: 'short', en: 'short' } }, 80);
    expect(out.title.de).toBe('short');
  });
});

describe('extractJson', () => {
  it('extracts json from ```json fences', () => {
    expect(__internal.extractJson('text\n```json\n{"a":1}\n```\nend')).toBe('{"a":1}');
  });

  it('falls back to the first { ... } block', () => {
    expect(__internal.extractJson('prose {"a":3} tail')).toBe('{"a":3}');
  });
});

describe('estimateCostCents', () => {
  it('returns a positive integer for the default model', () => {
    const cents = __internal.estimateCostCents('google/gemini-2.5-flash', 1000, 500);
    expect(cents).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(cents)).toBe(true);
  });

  it('scales with token counts', () => {
    const low = __internal.estimateCostCents('google/gemini-2.5-flash', 100, 100);
    const high = __internal.estimateCostCents('google/gemini-2.5-flash', 10_000, 10_000);
    expect(high).toBeGreaterThan(low);
  });
});

describe('assertImageUrlsSafe', () => {
  it('allows https URLs', () => {
    expect(() => __internal.assertImageUrlsSafe(['https://cdn.example.com/a.jpg'])).not.toThrow();
  });

  it('rejects more than 10 URLs', () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.jpg`);
    expect(() => __internal.assertImageUrlsSafe(urls)).toThrow(/too many/i);
  });

  it('rejects non-http schemes', () => {
    expect(() => __internal.assertImageUrlsSafe(['file:///etc/passwd'])).toThrow();
  });

  it('blocks private/loopback addresses (SSRF)', () => {
    expect(() => __internal.assertImageUrlsSafe(['http://localhost/x'])).toThrow();
    expect(() => __internal.assertImageUrlsSafe(['http://127.0.0.1/x'])).toThrow();
    expect(() => __internal.assertImageUrlsSafe(['http://169.254.169.254/latest'])).toThrow();
  });
});
