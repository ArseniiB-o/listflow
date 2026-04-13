/**
 * lib/marketplaces/sync.ts
 *
 * Handles inbound events from marketplaces (order placed, item sold-out)
 * and applies stock decrements. Ends listings on all other channels when
 * stock hits zero.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter } from './registry';
import { ALL_CHANNELS, type Channel } from './types';

export interface OrderEvent {
  channel: Channel;
  externalListingId: string;
  quantitySold: number;
}

export async function applyOrderEvent(event: OrderEvent): Promise<void> {
  const supabase = createAdminClient();

  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('product_id')
    .eq('marketplace', event.channel)
    .eq('external_id', event.externalListingId)
    .single<{ product_id: string }>();

  if (!listing) return;

  // Atomic decrement via RPC; falls back to application-level decrement.
  const { data: decremented, error: rpcErr } = await supabase.rpc(
    'atomic_decrement_stock',
    { p_product_id: listing.product_id, p_quantity: event.quantitySold },
  );

  let next: number | null;
  if (rpcErr || decremented == null) {
    const { data: product } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', listing.product_id)
      .single<{ stock_quantity: number | null }>();

    if (!product || product.stock_quantity == null) return;
    next = Math.max(0, product.stock_quantity - event.quantitySold);
    await supabase
      .from('products')
      .update({
        stock_quantity: next,
        stock_status: next === 0 ? 'out_of_stock' : 'in_stock',
      })
      .eq('id', listing.product_id);
  } else {
    next = typeof decremented === 'number' ? decremented : 0;
  }

  if (next != null && next === 0) {
    const others = ALL_CHANNELS.filter((c) => c !== event.channel);
    const { data: otherListings } = await supabase
      .from('marketplace_listings')
      .select('marketplace, external_id')
      .eq('product_id', listing.product_id)
      .in('marketplace', others)
      .eq('status', 'active');

    await Promise.all(
      (otherListings ?? []).map(async (row) => {
        if (!row.external_id) return;
        const adapter = getAdapter(row.marketplace as Channel);
        await adapter.end(row.external_id, 'sold');
        await supabase
          .from('marketplace_listings')
          .update({ status: 'sold_out', last_synced_at: new Date().toISOString() })
          .eq('product_id', listing.product_id)
          .eq('marketplace', row.marketplace);
      }),
    );
  }
}
