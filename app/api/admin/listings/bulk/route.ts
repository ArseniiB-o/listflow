/**
 * /api/admin/listings/bulk — fan out a publish across multiple products.
 *
 * Accepts:
 *   { productIds: string[]  (1..50)
 *     channels:   Channel[] (1..N) }
 *
 * Returns per-product results. Individual product failures do NOT abort
 * the batch (fail-soft, same as publishProduct).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publishProduct } from '@/lib/marketplaces/publish';
import { ALL_CHANNELS, type Channel } from '@/lib/marketplaces/types';
import { isAdminRequest, rateLimit, clientKey } from '@/lib/auth';
import { logger, errorContext } from '@/lib/logger';

const bulkSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(50),
  channels: z
    .array(z.enum(ALL_CHANNELS as unknown as [Channel, ...Channel[]]))
    .min(1),
});

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!rateLimit(`admin-bulk:${clientKey(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { productIds, channels } = parsed.data;

  const results = await Promise.all(
    productIds.map(async (productId) => {
      try {
        const channelResults = await publishProduct({ productId, channels });
        return { productId, ok: channelResults.every((r) => r.ok), results: channelResults };
      } catch (err) {
        logger.error('bulk publish: product failed', { productId, ...errorContext(err) });
        return { productId, ok: false, error: 'publish failed', results: [] };
      }
    }),
  );

  return NextResponse.json({ success: true, data: results });
}
