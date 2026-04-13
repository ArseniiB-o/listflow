/**
 * lib/marketplaces/publish.ts
 *
 * High-level orchestration: take a product id + list of channels, project
 * the product, fan out to adapters in parallel, record results.
 *
 * Fail-soft: a single channel failure does NOT abort the others.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter } from './registry';
import { projectProductToPayload } from './project';
import type { Channel, PublishResult } from './types';

interface PublishOptions {
  productId: string;
  channels: Channel[];
}

const STALE_PUBLISH_LOCK_MS = 60_000;

export async function publishProduct(opts: PublishOptions): Promise<PublishResult[]> {
  const payload = await projectProductToPayload(opts.productId);
  const supabase = createAdminClient();

  const results = await Promise.all(
    opts.channels.map(async (channel): Promise<PublishResult> => {
      const adapter = getAdapter(channel);

      const { data: current } = await supabase
        .from('marketplace_listings')
        .select('external_id, status, updated_at')
        .eq('product_id', opts.productId)
        .eq('marketplace', channel)
        .maybeSingle<{ external_id: string | null; status: string; updated_at: string }>();

      if (current?.status === 'publishing') {
        const ageMs = Date.now() - new Date(current.updated_at).getTime();
        if (ageMs < STALE_PUBLISH_LOCK_MS) {
          return {
            ok: false,
            channel,
            error: 'publish already in progress',
            retryable: true,
          };
        }
      }

      await supabase
        .from('marketplace_listings')
        .upsert(
          {
            product_id: opts.productId,
            marketplace: channel,
            status: 'publishing',
            payload_snapshot: payload as unknown as Record<string, unknown>,
          },
          { onConflict: 'product_id,marketplace' },
        );

      const existingExternalId = current?.external_id ?? null;

      const result =
        existingExternalId
          ? await adapter.update(existingExternalId, payload)
          : await adapter.publish(payload);

      if (result.ok) {
        await supabase
          .from('marketplace_listings')
          .update({
            status: 'active',
            external_id: result.externalId,
            external_url: result.externalUrl ?? null,
            error_message: null,
            last_synced_at: new Date().toISOString(),
          })
          .eq('product_id', opts.productId)
          .eq('marketplace', channel);
      } else {
        await supabase
          .from('marketplace_listings')
          .update({
            status: 'error',
            error_message: result.error,
            last_synced_at: new Date().toISOString(),
          })
          .eq('product_id', opts.productId)
          .eq('marketplace', channel);
      }

      return result;
    }),
  );

  return results;
}

export async function endListings(productId: string, channels: Channel[]): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('marketplace_listings')
    .select('marketplace, external_id')
    .eq('product_id', productId)
    .in('marketplace', channels);

  await Promise.all(
    (data ?? []).map(async (row) => {
      if (!row.external_id) return;
      const adapter = getAdapter(row.marketplace as Channel);
      await adapter.end(row.external_id, 'removed');
      await supabase
        .from('marketplace_listings')
        .update({ status: 'removed', last_synced_at: new Date().toISOString() })
        .eq('product_id', productId)
        .eq('marketplace', row.marketplace);
    }),
  );
}
