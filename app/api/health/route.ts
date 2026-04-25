/**
 * /api/health — liveness + dependency probe.
 *
 * Returns 200 with a JSON body describing each dependency. Never reveals
 * secrets. Used by uptime monitors and load balancers.
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfiguredChannels } from '@/lib/marketplaces/registry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const started = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number; detail?: string }> = {};

  // Supabase ping
  const supaStart = Date.now();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('marketplace_listings')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    checks.supabase = error
      ? { ok: false, detail: 'query failed' }
      : { ok: true, latencyMs: Date.now() - supaStart };
  } catch {
    checks.supabase = { ok: false, detail: 'client init failed' };
  }

  checks.openrouter = { ok: Boolean(env.OPENROUTER_API_KEY) };
  checks.telegram = { ok: Boolean(env.TELEGRAM_BOT_TOKEN) };

  const configured = getConfiguredChannels();

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? 'unknown',
      uptimeSec: Math.round(process.uptime?.() ?? 0),
      latencyMs: Date.now() - started,
      checks,
      configuredChannels: configured,
    },
    { status: allOk ? 200 : 503 },
  );
}
