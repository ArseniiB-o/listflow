/**
 * lib/marketplaces/amazon.ts
 *
 * Amazon.de stub adapter — generates Seller Central flat-file CSV rows.
 *
 * Amazon Individual Seller does NOT get SP-API Feeds access. This adapter
 * emits a flat-file row that the admin uploads manually at
 * sellercentral.amazon.de/listing/flatfiles.
 *
 * When upgrading to Professional (SP-API), swap the body of publish() for
 * a createFeed(JSON_LISTINGS_FEED) call — the rest of the engine stays the same.
 */

import 'server-only';
import { env } from '@/lib/env';
import type { MarketplaceAdapter, ListingPayload, PublishResult } from './types';

const FLAT_FILE_COLUMNS = [
  'sku',
  'product-id',
  'product-id-type',
  'price',
  'item-condition',
  'quantity',
  'add-delete',
  'will-ship-internationally',
  'expedited-shipping',
  'standard-price',
  'product-name',
  'product-description',
  'main-image-url',
  'other-image-url1',
  'other-image-url2',
  'other-image-url3',
  'manufacturer',
  'brand',
  'bullet-point1',
  'bullet-point2',
  'bullet-point3',
  'item-type-keyword',
  'target-audience-keywords',
  'merchant-shipping-group-name',
] as const;

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (s.includes('\t') || s.includes('\n') || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Build one tab-separated row in Seller Central flat-file format. */
export function buildAmazonRow(input: ListingPayload): string {
  const sku = `lf-${input.slug}`.slice(0, 40);
  const images = input.images.slice(0, 4).map((i) => i.url);

  const row: Record<(typeof FLAT_FILE_COLUMNS)[number], unknown> = {
    sku,
    'product-id': '',
    'product-id-type': '',
    price: input.priceEUR.toFixed(2),
    'item-condition': '11', // New
    quantity: input.stockQuantity ?? 1,
    'add-delete': 'a',
    'will-ship-internationally': '3',
    'expedited-shipping': 'N',
    'standard-price': input.priceEUR.toFixed(2),
    'product-name': input.title.de.slice(0, 200),
    'product-description': input.description.de.slice(0, 2000),
    'main-image-url': images[0] ?? '',
    'other-image-url1': images[1] ?? '',
    'other-image-url2': images[2] ?? '',
    'other-image-url3': images[3] ?? '',
    manufacturer: env.BRAND_NAME,
    brand: env.BRAND_NAME,
    'bullet-point1': input.materialHints[0] ?? '',
    'bullet-point2': input.materialHints[1] ?? '',
    'bullet-point3': input.materialHints[2] ?? '',
    'item-type-keyword': input.category,
    'target-audience-keywords': input.tags.de.slice(0, 5).join(', '),
    'merchant-shipping-group-name': 'Migrated Template',
  };

  return FLAT_FILE_COLUMNS.map((col) => csvEscape(row[col])).join('\t');
}

export function buildAmazonCsv(inputs: ListingPayload[]): string {
  const header = FLAT_FILE_COLUMNS.join('\t');
  const rows = inputs.map(buildAmazonRow);
  return [header, ...rows].join('\n');
}

export const amazonAdapter: MarketplaceAdapter = {
  channel: 'amazon_de',

  isConfigured(): boolean {
    return Boolean(env.AMAZON_SELLER_ID);
  },

  async publish(input: ListingPayload): Promise<PublishResult> {
    if (!env.AMAZON_SELLER_ID) {
      return {
        ok: false,
        channel: 'amazon_de',
        error: 'Amazon seller not configured (set AMAZON_SELLER_ID and upload the CSV manually)',
        retryable: false,
      };
    }
    return {
      ok: true,
      channel: 'amazon_de',
      externalId: `pending-${input.slug}`,
      externalUrl: `https://sellercentral.amazon.de/listing/flatfiles`,
      raw: { flatFileRow: buildAmazonRow(input) },
    };
  },

  async update(externalId: string, input: ListingPayload): Promise<PublishResult> {
    return this.publish({ ...input, productId: externalId });
  },

  async end(): Promise<void> {
    // Manual removal via Seller Central
  },
};
