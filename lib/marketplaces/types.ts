/**
 * lib/marketplaces/types.ts
 *
 * Shared types for the multichannel listing engine.
 * A single product is projected into one ListingPayload per channel;
 * each adapter consumes that payload and returns a PublishResult.
 */

export type Channel = 'self' | 'ebay_de' | 'etsy_de' | 'amazon_de';

export const ALL_CHANNELS: readonly Channel[] = [
  'self',
  'ebay_de',
  'etsy_de',
  'amazon_de',
] as const;

export type Locale = 'de' | 'en';

export type ListingStatus =
  | 'draft'
  | 'publishing'
  | 'active'
  | 'paused'
  | 'error'
  | 'sold_out'
  | 'removed';

export interface LocalizedString {
  de: string;
  en: string;
}

export interface LocalizedStringArray {
  de: string[];
  en: string[];
}

export interface ListingImage {
  url: string;
  altText?: string;
}

export interface ListingPayload {
  productId: string;
  slug: string;
  title: LocalizedString;
  description: LocalizedString;
  tags: LocalizedStringArray;
  priceEUR: number;
  compareAtPriceEUR?: number;
  stockQuantity: number | null; // null = unlimited / made-to-order
  weightGrams?: number;
  images: ListingImage[];
  category: string;
  productionDays?: number;
  suggestedCategoryPath: Partial<Record<Channel, string>>;
  materialHints: string[];
}

export type PublishResult =
  | {
      ok: true;
      channel: Channel;
      externalId: string;
      externalUrl?: string;
      raw?: unknown;
    }
  | {
      ok: false;
      channel: Channel;
      error: string;
      retryable: boolean;
      raw?: unknown;
    };

export interface MarketplaceAdapter {
  readonly channel: Channel;
  isConfigured(): boolean;
  publish(input: ListingPayload): Promise<PublishResult>;
  update(externalId: string, input: ListingPayload): Promise<PublishResult>;
  end(externalId: string, reason: 'sold' | 'removed' | 'pause'): Promise<void>;
  fetchStock?(externalId: string): Promise<number | null>;
}
