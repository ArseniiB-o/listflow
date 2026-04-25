import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Channel } from '@/lib/marketplaces/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ListingRow {
  marketplace: Channel;
  status: string;
}

interface CostRow {
  day: string;
  calls: number;
  cost_cents: number;
  avg_latency_ms: number;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  publishing: 'bg-blue-100 text-blue-800',
  draft: 'bg-zinc-100 text-zinc-700',
  error: 'bg-red-100 text-red-800',
  paused: 'bg-amber-100 text-amber-800',
  sold_out: 'bg-zinc-100 text-zinc-500',
  removed: 'bg-zinc-100 text-zinc-400',
};

export default async function MetricsPage() {
  const supabase = createAdminClient();
  const [{ data: listings }, { data: costs }] = await Promise.all([
    supabase.from('marketplace_listings').select('marketplace, status').returns<ListingRow[]>(),
    supabase
      .from('ai_daily_cost')
      .select('day, calls, cost_cents, avg_latency_ms')
      .order('day', { ascending: false })
      .limit(7)
      .returns<CostRow[]>(),
  ]);

  const counts: Record<string, Record<string, number>> = {};
  for (const r of listings ?? []) {
    counts[r.marketplace] ??= {};
    counts[r.marketplace][r.status] = (counts[r.marketplace][r.status] ?? 0) + 1;
  }
  const channels = Object.keys(counts).sort();
  const statuses = Array.from(new Set(Object.values(counts).flatMap((c) => Object.keys(c)))).sort();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-bold">Metrics</h1>
        <p className="text-sm text-zinc-500">Operational overview of listings and AI cost.</p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">Listings by channel</h2>
        {channels.length === 0 ? (
          <p className="text-zinc-500 text-sm">No listings yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Channel</th>
                  {statuses.map((s) => (
                    <th key={s} className="px-4 py-2">{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr key={ch} className="border-t">
                    <td className="px-4 py-2 font-medium">{ch}</td>
                    {statuses.map((s) => (
                      <td key={s} className="px-4 py-2">
                        {counts[ch][s] ? (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_BADGE[s] ?? ''}`}>
                            {counts[ch][s]}
                          </span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">AI cost — last 7 days</h2>
        {!costs || costs.length === 0 ? (
          <p className="text-zinc-500 text-sm">
            No AI usage tracked yet, or the <code>ai_daily_cost</code> view has not been created.
            Run <code>supabase/migrations/002_hardening.sql</code>.
          </p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Day</th>
                  <th className="px-4 py-2">Calls</th>
                  <th className="px-4 py-2">Cost (¢)</th>
                  <th className="px-4 py-2">Avg latency (ms)</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((row) => (
                  <tr key={row.day} className="border-t">
                    <td className="px-4 py-2">{row.day}</td>
                    <td className="px-4 py-2">{row.calls}</td>
                    <td className="px-4 py-2">{row.cost_cents}</td>
                    <td className="px-4 py-2">{row.avg_latency_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
