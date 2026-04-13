/**
 * Unit tests for Amazon flat-file CSV builder.
 */

process.env.NODE_ENV = 'test';
process.env.NEXTAUTH_SECRET = 'x'.repeat(32);
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';

import { buildAmazonRow, buildAmazonCsv } from '../lib/marketplaces/amazon';
import type { ListingPayload } from '../lib/marketplaces/types';

const sample: ListingPayload = {
  productId: '00000000-0000-0000-0000-000000000001',
  slug: 'amber-beeswax-candle',
  title: { de: 'Bernstein Bienenwachs Kerze', en: 'Amber Beeswax Candle' },
  description: { de: 'Handgegossene Kerze aus Bienenwachs.', en: 'Hand-poured beeswax candle.' },
  tags: { de: ['kerze', 'bienenwachs'], en: ['candle', 'beeswax'] },
  priceEUR: 34.5,
  stockQuantity: 3,
  images: [
    { url: 'https://example.com/1.jpg' },
    { url: 'https://example.com/2.jpg' },
  ],
  category: 'candle',
  suggestedCategoryPath: {},
  materialHints: ['beeswax', 'cotton wick'],
};

describe('buildAmazonRow', () => {
  it('produces a tab-separated row with 24 columns', () => {
    const cols = buildAmazonRow(sample).split('\t');
    expect(cols).toHaveLength(24);
  });

  it('formats price to 2 decimal places', () => {
    expect(buildAmazonRow(sample)).toContain('34.50');
  });

  it('derives sku from slug', () => {
    expect(buildAmazonRow(sample).startsWith('lf-amber-beeswax-candle')).toBe(true);
  });
});

describe('buildAmazonCsv', () => {
  it('prepends a header row', () => {
    const lines = buildAmazonCsv([sample]).split('\n');
    expect(lines[0]).toContain('sku\tproduct-id');
    expect(lines).toHaveLength(2);
  });

  it('supports multiple products', () => {
    expect(buildAmazonCsv([sample, { ...sample, slug: 'other' }]).split('\n')).toHaveLength(3);
  });
});
