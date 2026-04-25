import './setup';

// Verify the static bug-fix surface of the eBay adapter without making real
// network calls. We can confirm the adapter exposes the right shape and that
// `end()` does not throw when the API is unreachable (fail-soft contract).

import { ebayAdapter } from '../lib/marketplaces/ebay';

describe('ebayAdapter', () => {
  it('declares the ebay_de channel', () => {
    expect(ebayAdapter.channel).toBe('ebay_de');
  });

  it('isConfigured reflects EBAY_OAUTH_TOKEN presence', () => {
    const original = process.env.EBAY_OAUTH_TOKEN;
    delete process.env.EBAY_OAUTH_TOKEN;
    expect(ebayAdapter.isConfigured()).toBe(false);
    if (original) process.env.EBAY_OAUTH_TOKEN = original;
  });

  it('end() is fail-soft (never throws even if not configured)', async () => {
    delete process.env.EBAY_OAUTH_TOKEN;
    await expect(ebayAdapter.end('00000', 'removed')).resolves.toBeUndefined();
  });
});
