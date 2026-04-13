/**
 * /api/cron/sync-listings
 *
 * Scheduled entry point. Re-publishes any listing whose status is
 * 'publishing' or 'error' and was last touched 10+ minutes ago,
 * so transient failures self-heal.
 *
 * Auth: QStash signature (production) or Bearer NEXTAUTH_SECRET (dev).
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishProduct } from '@/lib/marketplaces/publish';
import type { Channel } from '@/lib/marketplaces/types';
import { sweepStaleDrafts } from '@/lib/telegram/session';

async function isAuthorized(req: NextRequest, rawBody: string): Promise<boolean> {
  if (env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY) {
    const sig = req.headers.get('upstash-signature');
    if (sig) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Receiver } = await import(/* webpackIgnore: true */ '@upstash/qstash' as string) as { Receiver: new (opts: { currentSigningKey: string; nextSigningKey: string }) => { verify: (p: { signature: string; body: string }) => Promise<boolean> } };
        const receiver = new Receiver({
          currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
          nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
        });
        return await receiver.verify({ signature: sig, body: rawBody });
      } catch {
        return false;
      }
    }
  }
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${env.NEXTAUTH_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req, ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: stuck, error } = await supabase
    .from('marketplace_listings')
    .select('product_id, marketplace')
    .in('status', ['publishing', 'error'])
    .lt('updated_at', tenMinAgo)
    .limit(25);

  if (error) {
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  const retries = stuck ?? [];
  const processed = await Promise.all(
    retries.map(async (row): Promise<{ productId: string; channel: Channel; ok: boolean }> => {
      try {
        const results = await publishProduct({
          productId: row.product_id,
          channels: [row.marketplace as Channel],
        });
        return {
          productId: row.product_id,
          channel: row.marketplace as Channel,
          ok: results.every((r) => r.ok),
        };
      } catch {
        return {
          productId: row.product_id,
          channel: row.marketplace as Channel,
          ok: false,
        };
      }
    }),
  );

  const draftsSwept = await sweepStaleDrafts(24).catch(() => 0);

  return NextResponse.json({ success: true, processed, draftsSwept });
}
