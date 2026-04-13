'use client';

import { useState } from 'react';

export interface ListingRow {
  id: string;
  productId: string;
  marketplace: string;
  externalId: string | null;
  externalUrl: string | null;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  productSlug: string;
  productName: string;
  productImage: string | null;
  productPrice: number;
}

const MARKETPLACE_LABEL: Record<string, string> = {
  self: 'Your Store',
  ebay_de: 'eBay.de',
  etsy_de: 'Etsy.de',
  amazon_de: 'Amazon.de',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-200',
  publishing: 'bg-blue-900 text-blue-200',
  active: 'bg-emerald-900 text-emerald-200',
  paused: 'bg-amber-900 text-amber-200',
  error: 'bg-red-900 text-red-200',
  sold_out: 'bg-zinc-800 text-zinc-400',
  removed: 'bg-zinc-900 text-zinc-500',
};

export function ListingsView({ rows }: { rows: ListingRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState(rows);

  async function resync(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, { method: 'POST' });
      if (res.ok) {
        setLocalRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'publishing' } : r)),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function endListing(id: string) {
    if (!confirm('End this listing?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setLocalRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'removed' } : r)),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Marketplace Listings</h1>
        <p className="text-sm text-gray-500">{localRows.length} listings</p>
      </div>

      {localRows.length === 0 ? (
        <p className="text-gray-500">No listings yet. Publish a product to get started.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3">Last Sync</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {localRows.map((row) => (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {row.productImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.productImage} alt="" className="w-10 h-10 object-cover rounded border" />
                      ) : (
                        <div className="w-10 h-10 bg-gray-100 rounded border" />
                      )}
                      <div>
                        <div className="font-medium">{row.productName}</div>
                        <div className="text-xs text-gray-500">{row.productPrice.toFixed(2)} EUR</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{MARKETPLACE_LABEL[row.marketplace] ?? row.marketplace}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${STATUS_COLOR[row.status] ?? ''}`}>
                      {row.status}
                    </span>
                    {row.errorMessage && (
                      <div className="text-xs text-red-500 mt-1 max-w-xs truncate" title={row.errorMessage}>
                        {row.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.externalUrl ? (
                      <a href={row.externalUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">
                        Open
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => resync(row.id)}
                      className="px-3 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Re-sync
                    </button>
                    {row.status !== 'removed' && (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => endListing(row.id)}
                        className="px-3 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        End
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
