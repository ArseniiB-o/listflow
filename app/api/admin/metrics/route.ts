/**
 * /api/admin/metrics
 *
 * Read-only operational dashboard payload:
 *   - per-channel listing counts by status
 *   - AI cost rollup (today, last 7 days)
 *   - recent webhook traffic
 *   - error sample (last 5)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminRequest } from '@/lib/auth';
import type { Channel } from '@/lib/marketplaces/types';

interface ListingStatusRow {
  marketplace: Channel;
  status: string;
}

interface AiCostRow {
  day: string;
  calls: number;
  cost_cents: number;
  input_tokens: number;
  output_tokens: number;
  avg_latency_ms: number;
}

interface RecentErrorRow {
  marketplace: Channel;
  error_message: string | null;
  updated_at: string;
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient();

  const [{ data: listings }, { data: aiCost }, { data: errs }] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('marketplace, status')
      .returns<ListingStatusRow[]>(),
    supabase
      .from('ai_daily_cost')
      .select('day, calls, cost_cents, input_tokens, output_tokens, avg_latency_ms')
      .order('day', { ascending: false })
      .limit(7)
      .returns<AiCostRow[]>(),
    supabase
      .from('marketplace_listings')
      .select('marketplace, error_message, updated_at')
      .eq('status', 'error')
      .order('updated_at', { ascending: false })
      .limit(5)
      .returns<RecentErrorRow[]>(),
  ]);

  const byChannel: Record<string, Record<string, number>> = {};
  for (const row of listings ?? []) {
    byChannel[row.marketplace] ??= {};
    byChannel[row.marketplace][row.status] = (byChannel[row.marketplace][row.status] ?? 0) + 1;
  }

  return NextResponse.json({
    success: true,
    data: {
      listingsByChannel: byChannel,
      aiCostLast7Days: aiCost ?? [],
      recentErrors: errs ?? [],
    },
  });
}
