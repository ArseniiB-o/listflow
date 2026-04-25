import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter } from '@/lib/marketplaces/registry';
import { publishProduct } from '@/lib/marketplaces/publish';
import type { Channel } from '@/lib/marketplaces/types';
import { isAdminRequest, rateLimit, clientKey } from '@/lib/auth';
import { logger, errorContext } from '@/lib/logger';

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!rateLimit(`admin-resync:${clientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { id } = await params;
  const parseId = idSchema.safeParse(id);
  if (!parseId.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from('marketplace_listings')
    .select('product_id, marketplace')
    .eq('id', parseId.data)
    .single<{ product_id: string; marketplace: Channel }>();

  if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const results = await publishProduct({
      productId: row.product_id,
      channels: [row.marketplace],
    });
    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    logger.error('admin listings/[id]: resync failed', errorContext(err));
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!rateLimit(`admin-end:${clientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { id } = await params;
  const parseId = idSchema.safeParse(id);
  if (!parseId.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from('marketplace_listings')
    .select('product_id, marketplace, external_id')
    .eq('id', parseId.data)
    .single<{ product_id: string; marketplace: Channel; external_id: string | null }>();

  if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!row.external_id) {
    return NextResponse.json({ error: 'Listing has no external id yet' }, { status: 409 });
  }

  try {
    const adapter = getAdapter(row.marketplace);
    await adapter.end(row.external_id, 'removed');
    await supabase
      .from('marketplace_listings')
      .update({ status: 'removed', last_synced_at: new Date().toISOString() })
      .eq('id', parseId.data);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('admin listings/[id]: end failed', errorContext(err));
    return NextResponse.json({ error: 'End failed' }, { status: 500 });
  }
}
