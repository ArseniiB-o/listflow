/**
 * /api/webhooks/ebay
 *
 * eBay Notifications endpoint.
 *   GET:  Marketplace Account Deletion challenge (returns SHA-256 of
 *         challengeCode + verificationToken + endpoint URL).
 *   POST: Order/listing notifications. Deduplicates via webhook_events.
 *
 * Auth model:
 *   - The challenge response itself proves endpoint ownership.
 *   - Notifications are restricted to known POST shape; we additionally
 *     gate on the verification token sent in `x-ebay-verification` header
 *     OR a JWT in Authorization (eBay's actual mechanism is JWT-based; the
 *     verification token header was retained for backwards compatibility
 *     with v0 callers that signed with our shared secret).
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { applyOrderEvent } from '@/lib/marketplaces/sync';
import { recordWebhookEvent } from '@/lib/idempotency';
import { logger, errorContext } from '@/lib/logger';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) {
    return NextResponse.json({ error: 'Missing challenge_code' }, { status: 400 });
  }
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
  notificationId?: string;
  metadata?: { topic?: string; schemaVersion?: string };
  notification?: {
    notificationId?: string;
    eventDate?: string;
    publishDate?: string;
    publishAttemptCount?: number;
    data?: {
      listingId?: string;
      soldQuantity?: number;
      orderId?: string;
    };
  };
}

export async function POST(req: NextRequest) {
  if (!env.EBAY_WEBHOOK_VERIFICATION_TOKEN) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // Accept either a shared verification token (legacy) OR a Bearer token equal
  // to the verification token. Reject everything else — eBay's modern flow uses
  // OAuth-signed JWTs which this template does not yet implement; configure a
  // long random EBAY_WEBHOOK_VERIFICATION_TOKEN and set it as the shared secret.
  const sigHeader = req.headers.get('x-ebay-verification') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const tokenOk =
    (sigHeader && timingSafeEqual(sigHeader, env.EBAY_WEBHOOK_VERIFICATION_TOKEN)) ||
    (bearerToken && timingSafeEqual(bearerToken, env.EBAY_WEBHOOK_VERIFICATION_TOKEN));

  if (!tokenOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: EbayNotification;
  try {
    body = (await req.json()) as EbayNotification;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId =
    body.notification?.notificationId ?? body.notificationId ?? '';
  if (eventId) {
    const fresh = await recordWebhookEvent('ebay', eventId, body as unknown as Record<string, unknown>);
    if (!fresh) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  try {
    const topic = body.metadata?.topic ?? '';
    if (topic.includes('ITEM_SOLD') && body.notification?.data?.listingId) {
      await applyOrderEvent({
        channel: 'ebay_de',
        externalListingId: body.notification.data.listingId,
        quantitySold: body.notification.data.soldQuantity ?? 1,
      });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('ebay webhook: handler failed', errorContext(err));
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
