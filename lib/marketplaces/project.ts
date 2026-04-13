/**
 * lib/marketplaces/project.ts
 *
 * Projects a row from the products table into a normalized ListingPayload
 * that every marketplace adapter can consume.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import type { ListingPayload, ListingImage } from './types';

interface ProductRow {
  id: string;
  slug: string;
  name: Record<string, string>;
  description: Record<string, string>;
  price: number | string;
  compare_at_price: number | string | null;
  images: string[];
  weight_grams: number | null;
  stock_quantity: number | null;
  production_days: number | null;
  details: Record<string, unknown>;
  category_id: string | null;
}

interface CategoryRow {
  slug: string;
}

function pick(localized: Record<string, string>, locale: 'de' | 'en'): string {
  return (
    localized[locale] ||
    localized.en ||
    localized.de ||
    Object.values(localized).find((v) => typeof v === 'string' && v.length > 0) ||
    ''
  );
}

function toPublicImageUrls(paths: string[]): ListingImage[] {
  const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  return paths.slice(0, 10).map((path) => {
    const url = /^https?:\/\//.test(path)
      ? path
      : `${base}/storage/v1/object/public/product-images/${path.replace(/^\//, '')}`;
    return { url };
  });
}

export async function projectProductToPayload(productId: string): Promise<ListingPayload> {
  const supabase = createAdminClient();

  const { data: product, error } = await supabase
    .from('products')
    .select('id, slug, name, description, price, compare_at_price, images, weight_grams, stock_quantity, production_days, details, category_id')
    .eq('id', productId)
    .single<ProductRow>();

  if (error || !product) throw new Error(`Product ${productId} not found`);

  let categorySlug = 'general';
  if (product.category_id) {
    const { data: cat } = await supabase
      .from('categories')
      .select('slug')
      .eq('id', product.category_id)
      .single<CategoryRow>();
    if (cat?.slug) categorySlug = cat.slug;
  }

  const details = product.details ?? {};
  const tagsDetail = details as { tags?: { de?: string[]; en?: string[] }; materialHints?: string[]; suggestedCategoryPath?: Record<string, string> };

  return {
    productId: product.id,
    slug: product.slug,
    title: {
      de: pick(product.name, 'de'),
      en: pick(product.name, 'en'),
    },
    description: {
      de: pick(product.description, 'de'),
      en: pick(product.description, 'en'),
    },
    tags: {
      de: tagsDetail.tags?.de ?? [],
      en: tagsDetail.tags?.en ?? [],
    },
    priceEUR: Number(product.price),
    compareAtPriceEUR: product.compare_at_price != null ? Number(product.compare_at_price) : undefined,
    stockQuantity: product.stock_quantity,
    weightGrams: product.weight_grams ?? undefined,
    images: toPublicImageUrls(product.images ?? []),
    category: categorySlug,
    productionDays: product.production_days ?? undefined,
    suggestedCategoryPath: (tagsDetail.suggestedCategoryPath ?? {}) as ListingPayload['suggestedCategoryPath'],
    materialHints: tagsDetail.materialHints ?? [],
  };
}
