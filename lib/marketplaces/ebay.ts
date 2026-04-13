/**
 * lib/marketplaces/ebay.ts
 *
 * eBay Sell API adapter (Inventory + Offer endpoints).
 * Marketplace: EBAY_DE. Swap MARKETPLACE_ID for other eBay sites.
 *
 * Flow:
 *   1. PUT   /sell/inventory/v1/inventory_item/{sku}
 *   2. POST  /sell/inventory/v1/offer
 *   3. POST  /sell/inventory/v1/offer/{offerId}/publish
 */

import 'server-only';
import { env } from '@/lib/env';
import type { MarketplaceAdapter, ListingPayload, PublishResult } from './types';
import { fetchWithTimeout, retryWithBackoff, HttpError } from './fetch';

const API_BASE =
  env.EBAY_ENVIRONMENT === 'production'
    ? 'https://api.ebay.com'
    : 'https://api.sandbox.ebay.com';

const MARKETPLACE_ID = 'EBAY_DE';
const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_LOCALE = 'de-DE';

interface EbayError {
  errors?: Array<{ message: string; longMessage?: string }>;
}

async function ebayFetch<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.EBAY_OAUTH_TOKEN) {
    throw new Error('EBAY_OAUTH_TOKEN is not configured');
  }
  return retryWithBackoff(async () => {
    const res = await fetchWithTimeout(
      `${API_BASE}${path}`,
      {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.EBAY_OAUTH_TOKEN}`,
          'content-language': DEFAULT_LOCALE,
          'accept-language': DEFAULT_LOCALE,
          'x-ebay-c-marketplace-id': MARKETPLACE_ID,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      30_000,
    );

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(res.status, `eBay API returned non-JSON (${res.status})`, text.slice(0, 500));
    }

    if (!res.ok) {
      const err = json as EbayError;
      const msg = err.errors?.[0]?.longMessage ?? err.errors?.[0]?.message ?? `eBay API ${res.status}`;
      throw new HttpError(res.status, msg, text);
    }
    return json as T;
  });
}

function buildInventoryItem(input: ListingPayload) {
  return {
    product: {
      title: input.title.de,
      description: input.description.de,
      imageUrls: input.images.slice(0, 12).map((i) => i.url),
      aspects: {
        Marke: [env.BRAND_NAME],
        ...(input.materialHints.length ? { Material: input.materialHints } : {}),
      },
    },
    condition: 'NEW',
    availability: {
      shipToLocationAvailability: {
        quantity: input.stockQuantity ?? 1,
      },
    },
    ...(input.weightGrams
      ? {
          packageWeightAndSize: {
            weight: { value: input.weightGrams / 1000, unit: 'KILOGRAM' },
          },
        }
      : {}),
  };
}

interface EbayOffer {
  offerId: string;
  listing?: { listingId?: string };
}

function buildOffer(input: ListingPayload, sku: string) {
  return {
    sku,
    marketplaceId: MARKETPLACE_ID,
    format: 'FIXED_PRICE',
    availableQuantity: input.stockQuantity ?? 1,
    categoryId: input.suggestedCategoryPath.ebay_de ?? '14339',
    listingDescription: input.description.de,
    listingPolicies: {
      fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID ?? '',
      paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID ?? '',
      returnPolicyId: env.EBAY_RETURN_POLICY_ID ?? '',
    },
    pricingSummary: {
      price: { value: input.priceEUR.toFixed(2), currency: DEFAULT_CURRENCY },
    },
  };
}

function skuFor(input: ListingPayload): string {
  return `lf-${input.slug}`.slice(0, 50);
}

export const ebayAdapter: MarketplaceAdapter = {
  channel: 'ebay_de',

  isConfigured(): boolean {
    return Boolean(env.EBAY_OAUTH_TOKEN);
  },

  async publish(input: ListingPayload): Promise<PublishResult> {
    try {
      const sku = skuFor(input);
      await ebayFetch('PUT', `/sell/inventory/v1/inventory_item/${sku}`, buildInventoryItem(input));
      const offer = await ebayFetch<EbayOffer>('POST', '/sell/inventory/v1/offer', buildOffer(input, sku));
      const published = await ebayFetch<{ listingId: string }>(
        'POST',
        `/sell/inventory/v1/offer/${offer.offerId}/publish`,
      );
      return {
        ok: true,
        channel: 'ebay_de',
        externalId: published.listingId,
        externalUrl: `https://www.ebay.de/itm/${published.listingId}`,
        raw: { sku, offerId: offer.offerId },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown eBay error';
      return {
        ok: false,
        channel: 'ebay_de',
        error: message,
        retryable: !/invalid|unauthorized|forbidden/i.test(message),
      };
    }
  },

  async update(externalId: string, input: ListingPayload): Promise<PublishResult> {
    try {
      const sku = skuFor(input);
      await ebayFetch('PUT', `/sell/inventory/v1/inventory_item/${sku}`, buildInventoryItem(input));
      return {
        ok: true,
        channel: 'ebay_de',
        externalId,
        externalUrl: `https://www.ebay.de/itm/${externalId}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown eBay error';
      return { ok: false, channel: 'ebay_de', error: message, retryable: true };
    }
  },

  async end(externalId: string): Promise<void> {
    try {
      await ebayFetch('DELETE', `/sell/inventory/v1/inventory_item/lf-${externalId}`);
    } catch {
      // fail-soft
    }
  },
};
