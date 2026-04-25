/**
 * /api/webhooks/etsy
 *
 * Etsy does not offer first-party webhooks. This endpoint accepts forwarded
 * order notifications from a relay (Zapier, Make.com, n8n) authenticated with
 * Bearer ETSY_WEBHOOK_SECRET. Events are deduplicated via webhook_events.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { applyOrderEvent } from '@/lib/marketplaces/sync';
import { recordWebhookEvent } from '@/lib/idempotency';
import { logger, errorContext } from '@/lib/logger';

interface EtsyRelayPayload {
  event_id?: string;
  listing_id?: string | number;
  quantity?: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function POST(req: NextRequest) {
  if (!env.ETSY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.ETSY_WEBHOOK_SECRET}`;
  if (!auth || !timingSafeEqual(auth, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: EtsyRelayPayload;
  try {
    body = (await req.json()) as EtsyRelayPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.event_id) {
    const fresh = await recordWebhookEvent('etsy', body.event_id, body as unknown as Record<string, unknown>);
    if (!fresh) return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    if (body.listing_id) {
      await applyOrderEvent({
        channel: 'etsy_de',
        externalListingId: String(body.listing_id),
        quantitySold: body.quantity ?? 1,
      });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('etsy webhook: handler failed', errorContext(err));
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
