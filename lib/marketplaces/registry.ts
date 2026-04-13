/**
 * lib/marketplaces/registry.ts — central adapter lookup
 */

import 'server-only';
import type { Channel, MarketplaceAdapter } from './types';
import { selfAdapter } from './self';
import { ebayAdapter } from './ebay';
import { etsyAdapter } from './etsy';
import { amazonAdapter } from './amazon';

const REGISTRY: Record<Channel, MarketplaceAdapter> = {
  self: selfAdapter,
  ebay_de: ebayAdapter,
  etsy_de: etsyAdapter,
  amazon_de: amazonAdapter,
};

export function getAdapter(channel: Channel): MarketplaceAdapter {
  return REGISTRY[channel];
}

export function getConfiguredChannels(): Channel[] {
  return (Object.keys(REGISTRY) as Channel[]).filter((c) => REGISTRY[c].isConfigured());
}
