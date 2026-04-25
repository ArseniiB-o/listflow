/**
 * /api/cron/sync-listings
 *
 * Scheduled entry point — wakes stuck listings:
 *   - status='publishing' or 'error' AND updated_at < now()-10min  → re-publish
 *   - cleans up stale Telegram drafts
 *
 * Auth (one of):
 *   - QStash JWT (Upstash) — verified locally with HMAC-SHA256 against
 *     QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY.
 *   - Vercel Cron — verified by `x-vercel-cron-secret` header
 *     equal to NEXTAUTH_SECRET (or VERCEL_CRON_SECRET if set).
 *   - Manual: Authorization: Bearer NEXTAUTH_SECRET (dev only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishProduct } from '@/lib/marketplaces/publish';
import type { Channel } from '@/lib/marketplaces/types';
import { sweepStaleDrafts } from '@/lib/telegram/session';
import { logger, errorContext } from '@/lib/logger';

function base64UrlDecode(input: string): Uint8Array {
  const pad = (4 - (input.length % 4)) % 4;
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

async function verifyQstashJwt(token: string, key: string, body: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = base64UrlDecode(sigB64);
  // crypto.subtle.verify wants a BufferSource; pass a fresh ArrayBuffer.
  const sigBuf = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
  const ok = await crypto.subtle.verify(
    'HMAC',
    cryptoKey,
    sigBuf,
    enc.encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return false;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as { body?: string; exp?: number };
    if (payload.exp && Date.now() / 1000 > payload.exp) return false;
    if (payload.body) {
      const want = base64UrlDecode(payload.body);
      const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(body)));
      if (!bytesEqual(want, bodyHash)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

async function isAuthorized(req: NextRequest, rawBody: string): Promise<boolean> {
  // QStash signature
  const sig = req.headers.get('upstash-signature');
  if (sig) {
    if (env.QSTASH_CURRENT_SIGNING_KEY) {
      if (await verifyQstashJwt(sig, env.QSTASH_CURRENT_SIGNING_KEY, rawBody)) return true;
    }
    if (env.QSTASH_NEXT_SIGNING_KEY) {
      if (await verifyQstashJwt(sig, env.QSTASH_NEXT_SIGNING_KEY, rawBody)) return true;
    }
    return false;
  }

  // Vercel Cron
  const vercelSig = req.headers.get('x-vercel-cron-secret');
  if (vercelSig && vercelSig === env.NEXTAUTH_SECRET) return true;

  // Bearer fallback (dev/manual)
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${env.NEXTAUTH_SECRET}`;
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_BATCH = 50;

async function processBatch(): Promise<{ ok: number; fail: number; total: number }> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const { data: stuck, error } = await supabase
    .from('marketplace_listings')
    .select('product_id, marketplace')
    .in('status', ['publishing', 'error'])
    .lt('updated_at', cutoff)
    .limit(MAX_BATCH);

  if (error) throw new Error(error.message);
  const rows = stuck ?? [];

  let ok = 0;
  let fail = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        const results = await publishProduct({
          productId: row.product_id,
          channels: [row.marketplace as Channel],
        });
        if (results.every((r) => r.ok)) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }),
  );
  return { ok, fail, total: rows.length };
}

async function handle(req: NextRequest, rawBody: string) {
  if (!(await isAuthorized(req, rawBody))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await processBatch();
    const draftsSwept = await sweepStaleDrafts(24).catch(() => 0);
    return NextResponse.json({ success: true, ...summary, draftsSwept });
  } catch (err) {
    logger.error('cron sync-listings: failed', errorContext(err));
    return NextResponse.json({ error: 'Cron run failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req, '');
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // Re-construct request with body for handlers that need it (none here).
  return handle(req, raw);
}
