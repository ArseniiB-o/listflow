import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishProduct } from '@/lib/marketplaces/publish';
import { ALL_CHANNELS, type Channel } from '@/lib/marketplaces/types';
import { isAdminRequest, rateLimit, clientKey } from '@/lib/auth';
import { logger, errorContext } from '@/lib/logger';

const publishSchema = z.object({
  productId: z.string().uuid(),
  channels: z.array(z.enum(ALL_CHANNELS as unknown as [Channel, ...Channel[]])).min(1),
});

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select(
      'id, product_id, marketplace, external_id, external_url, status, error_message, last_synced_at, updated_at, products(slug, name, images, price)',
    )
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error('admin listings: load failed', { error: error.message });
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`admin-publish:${clientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const results = await publishProduct(parsed.data);
    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    logger.error('admin listings: publish failed', errorContext(err));
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}
