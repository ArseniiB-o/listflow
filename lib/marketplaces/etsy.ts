/**
 * lib/marketplaces/etsy.ts
 *
 * Etsy v3 Open API adapter.
 *
 * Flow:
 *   1. POST /v3/application/shops/{shop_id}/listings          — createDraftListing
 *   2. POST /v3/application/shops/{shop_id}/listings/{id}/images — uploadListingImage
 *   3. PATCH /v3/application/shops/{shop_id}/listings/{id}    — activate
 */

import 'server-only';
import { env } from '@/lib/env';
import type { MarketplaceAdapter, ListingPayload, PublishResult } from './types';
import { fetchWithTimeout, retryWithBackoff, HttpError } from './fetch';

const API_BASE = 'https://openapi.etsy.com';

interface EtsyError {
  error?: string;
  error_description?: string;
}

async function etsyFetch<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.ETSY_OAUTH_TOKEN || !env.ETSY_API_KEY) {
    throw new Error('ETSY_OAUTH_TOKEN / ETSY_API_KEY not configured');
  }

  const headers: Record<string, string> = {
    'x-api-key': env.ETSY_API_KEY,
    authorization: `Bearer ${env.ETSY_OAUTH_TOKEN}`,
  };

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isFormData) {
      payload = body as FormData;
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  return retryWithBackoff(async () => {
    const res = await fetchWithTimeout(
      `${API_BASE}${path}`,
      { method, headers, body: payload },
      30_000,
    );
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(res.status, `Etsy API returned non-JSON (${res.status})`, text.slice(0, 500));
    }

    if (!res.ok) {
      const err = json as EtsyError;
      const msg = err.error_description ?? err.error ?? `Etsy API ${res.status}`;
      throw new HttpError(res.status, msg, text);
    }
    return json as T;
  });
}

function normalizeEtsyTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().slice(0, 20);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length === 13) break;
  }
  return out;
}

function buildDraftBody(input: ListingPayload) {
  const taxonomyId = input.suggestedCategoryPath.etsy_de
    ? parseInt(input.suggestedCategoryPath.etsy_de, 10)
    : 1633; // "Home & Living > Home Decor > Candles & Holders" — change to your category

  return {
    quantity: input.stockQuantity ?? 1,
    title: input.title.en,
    description: input.description.en,
    price: input.priceEUR,
    who_made: 'i_did',
    when_made: 'made_to_order',
    taxonomy_id: isNaN(taxonomyId) ? 1633 : taxonomyId,
    type: 'physical',
    tags: normalizeEtsyTags(input.tags.en),
    materials: input.materialHints.slice(0, 13),
    state: 'draft',
  };
}

interface EtsyListingResponse {
  listing_id: number;
  url?: string;
}

function assertSafeImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid image URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('image URL must be http(s)');
  }
  const host = url.hostname.toLowerCase();
  const BLOCKED =
    /^(localhost|0\.0\.0\.0|127\.\d|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fd[0-9a-f]{2}:|\[::1\])/i;
  if (BLOCKED.test(host)) throw new Error(`blocked private host: ${host}`);
  return url;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function uploadImages(shopId: string, listingId: number, urls: string[]): Promise<void> {
  for (const [index, raw] of urls.slice(0, 10).entries()) {
    let url: URL;
    try {
      url = assertSafeImageUrl(raw);
    } catch {
      continue;
    }
    const imgRes = await fetchWithTimeout(url.toString(), {}, 30_000);
    if (!imgRes.ok) continue;
    const lengthHeader = imgRes.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) continue;
    const blob = await imgRes.blob();
    if (blob.size > MAX_IMAGE_BYTES) continue;
    const form = new FormData();
    form.append('image', blob, `image-${index}.jpg`);
    form.append('rank', String(index + 1));
    await etsyFetch(
      'POST',
      `/v3/application/shops/${shopId}/listings/${listingId}/images`,
      form,
    );
  }
}

export const etsyAdapter: MarketplaceAdapter = {
  channel: 'etsy_de',

  isConfigured(): boolean {
    return Boolean(env.ETSY_OAUTH_TOKEN && env.ETSY_API_KEY && env.ETSY_SHOP_ID);
  },

  async publish(input: ListingPayload): Promise<PublishResult> {
    try {
      const shopId = env.ETSY_SHOP_ID!;
      const draft = await etsyFetch<EtsyListingResponse>(
        'POST',
        `/v3/application/shops/${shopId}/listings`,
        buildDraftBody(input),
      );
      await uploadImages(shopId, draft.listing_id, input.images.map((i) => i.url));
      await etsyFetch(
        'PATCH',
        `/v3/application/shops/${shopId}/listings/${draft.listing_id}`,
        { state: 'active' },
      );
      return {
        ok: true,
        channel: 'etsy_de',
        externalId: String(draft.listing_id),
        externalUrl: draft.url ?? `https://www.etsy.com/listing/${draft.listing_id}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Etsy error';
      return {
        ok: false,
        channel: 'etsy_de',
        error: message,
        retryable: !/invalid|unauthorized|forbidden/i.test(message),
      };
    }
  },

  async update(externalId: string, input: ListingPayload): Promise<PublishResult> {
    try {
      const shopId = env.ETSY_SHOP_ID!;
      await etsyFetch(
        'PATCH',
        `/v3/application/shops/${shopId}/listings/${externalId}`,
        {
          title: input.title.en,
          description: input.description.en,
          price: input.priceEUR,
          quantity: input.stockQuantity ?? 1,
          tags: normalizeEtsyTags(input.tags.en),
        },
      );
      return {
        ok: true,
        channel: 'etsy_de',
        externalId,
        externalUrl: `https://www.etsy.com/listing/${externalId}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Etsy error';
      return { ok: false, channel: 'etsy_de', error: message, retryable: true };
    }
  },

  async end(externalId: string): Promise<void> {
    try {
      const shopId = env.ETSY_SHOP_ID!;
      await etsyFetch('DELETE', `/v3/application/shops/${shopId}/listings/${externalId}`);
    } catch {
      // fail-soft
    }
  },
};
