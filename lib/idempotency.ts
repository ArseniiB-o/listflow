/**
 * lib/idempotency.ts — webhook event deduplication.
 *
 * Marketplaces (eBay, Etsy relays, Telegram) routinely retry deliveries.
 * `recordWebhookEvent` returns:
 *   - true   first time we see this (source, eventId) → caller proceeds
 *   - false  already processed → caller should ack and skip work
 *
 * Storage: webhook_events table (see migration). Falls back to allow-and-log
 * if the table is missing, so the system stays available during migration.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export type WebhookSource = 'ebay' | 'etsy' | 'telegram' | 'qstash';

export async function recordWebhookEvent(
  source: WebhookSource,
  eventId: string,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  if (!eventId) return true;
  const supabase = createAdminClient();
  const { error } = await supabase.from('webhook_events').insert({
    source,
    event_id: eventId,
    payload: payload ?? {},
  });

  if (!error) return true;

  // 23505 = unique violation → duplicate, drop silently.
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    return false;
  }

  // Table missing or other transient → log and allow (fail-open for availability).
  logger.warn('idempotency: insert failed, allowing event through', {
    source,
    eventId,
    error: String((error as { message?: string }).message ?? error),
  });
  return true;
}
