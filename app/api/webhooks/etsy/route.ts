/**
 * /api/webhooks/etsy
 *
 * Etsy does not offer webhooks — this route accepts forwarded order
 * notifications from a relay (e.g. Zapier) or the sync worker.
 * Auth via Bearer token from ETSY_WEBHOOK_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { applyOrderEvent } from '@/lib/marketplaces/sync';

interface EtsyRelayPayload {
  listing_id?: string | number;
  quantity?: number;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = env.ETSY_WEBHOOK_SECRET ? `Bearer ${env.ETSY_WEBHOOK_SECRET}` : '';
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as EtsyRelayPayload;
    if (body.listing_id) {
      await applyOrderEvent({
        channel: 'etsy_de',
        externalListingId: String(body.listing_id),
        quantitySold: body.quantity ?? 1,
      });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[etsy webhook]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
