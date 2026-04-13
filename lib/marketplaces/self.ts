/**
 * lib/marketplaces/self.ts
 *
 * Internal "marketplace" adapter — your own storefront. Publishing means
 * marking the product active in the database. This adapter exists so the
 * engine can treat every channel uniformly.
 */

import 'server-only';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MarketplaceAdapter, ListingPayload, PublishResult } from './types';

function buildPublicUrl(slug: string): string {
  const base = env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/shop/${slug}`;
}

export const selfAdapter: MarketplaceAdapter = {
  channel: 'self',

  isConfigured(): boolean {
    return true;
  },

  async publish(input: ListingPayload): Promise<PublishResult> {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('products')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', input.productId);

    if (error) {
      return {
        ok: false,
        channel: 'self',
        error: 'Failed to activate product',
        retryable: true,
      };
    }

    return {
      ok: true,
      channel: 'self',
      externalId: input.productId,
      externalUrl: buildPublicUrl(input.slug),
    };
  },

  async update(externalId: string, input: ListingPayload): Promise<PublishResult> {
    return this.publish({ ...input, productId: externalId });
  },

  async end(externalId: string): Promise<void> {
    const supabase = createAdminClient();
    await supabase.from('products').update({ is_active: false }).eq('id', externalId);
  },
};
