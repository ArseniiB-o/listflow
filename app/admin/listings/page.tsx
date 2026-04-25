import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { ListingsView, type ListingRow } from '@/components/admin/listings-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RawListingRow {
  id: string;
  product_id: string;
  marketplace: string;
  external_id: string | null;
  external_url: string | null;
  status: string;
  error_message: string | null;
  last_synced_at: string | null;
  updated_at: string;
  products: {
    slug: string;
    name: Record<string, string> | null;
    images: string[] | null;
    price: number | string | null;
  } | null;
}

function pickName(name: Record<string, string> | null): string {
  if (!name) return '(untitled)';
  return name.de || name.en || Object.values(name)[0] || '(untitled)';
}

export default async function AdminListingsPage() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select(
      'id, product_id, marketplace, external_id, external_url, status, error_message, last_synced_at, updated_at, products(slug, name, images, price)',
    )
    .order('updated_at', { ascending: false })
    .limit(200)
    .returns<RawListingRow[]>();

  if (error) {
    return <p className="text-red-600">Failed to load listings.</p>;
  }

  const rows: ListingRow[] = (data ?? []).map((r) => ({
    id: r.id,
    productId: r.product_id,
    marketplace: r.marketplace,
    externalId: r.external_id,
    externalUrl: r.external_url,
    status: r.status,
    errorMessage: r.error_message,
    lastSyncedAt: r.last_synced_at,
    updatedAt: r.updated_at,
    productSlug: r.products?.slug ?? '',
    productName: pickName(r.products?.name ?? null),
    productImage: r.products?.images?.[0] ?? null,
    productPrice: r.products?.price != null ? Number(r.products.price) : 0,
  }));

  return <ListingsView rows={rows} />;
}
