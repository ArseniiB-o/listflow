/**
 * /api/webhooks/ebay
 *
 * eBay notification endpoint:
 *   GET:  challenge response (hash token for webhook registration)
 *   POST: signed notification (order events, account deletion)
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { applyOrderEvent } from '@/lib/marketplaces/sync';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) return NextResponse.json({ error: 'Missing challenge_code' }, { status: 400 });
  if (!env.EBAY_WEBHOOK_VERIFICATION_TOKEN) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const endpoint = `${env.NEXTAUTH_URL.replace(/\/$/, '')}/api/webhooks/ebay`;
  const response = await sha256Hex(
    challengeCode + env.EBAY_WEBHOOK_VERIFICATION_TOKEN + endpoint,
  );
  return NextResponse.json({ challengeResponse: response });
}

interface EbayNotification {
  metadata?: { topic?: string };
  notification?: {
    data?: {
      listingId?: string;
      soldQuantity?: number;
    };
  };
}

export async function POST(req: NextRequest) {
  if (!env.EBAY_WEBHOOK_VERIFICATION_TOKEN) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const sig = req.headers.get('x-ebay-verification') ?? '';
  if (!sig || !timingSafeEqual(sig, env.EBAY_WEBHOOK_VERIFICATION_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as EbayNotification;
    const topic = body.metadata?.topic ?? '';

    if (topic.includes('ITEM_SOLD') && body.notification?.data?.listingId) {
      await applyOrderEvent({
        channel: 'ebay_de',
        externalListingId: body.notification.data.listingId,
        quantitySold: body.notification.data.soldQuantity ?? 1,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[ebay webhook]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
