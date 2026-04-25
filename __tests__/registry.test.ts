import './setup';
import { getAdapter, getConfiguredChannels } from '../lib/marketplaces/registry';
import { ALL_CHANNELS } from '../lib/marketplaces/types';

describe('marketplace registry', () => {
  it('returns an adapter for every declared channel', () => {
    for (const channel of ALL_CHANNELS) {
      const adapter = getAdapter(channel);
      expect(adapter.channel).toBe(channel);
      expect(typeof adapter.isConfigured).toBe('function');
      expect(typeof adapter.publish).toBe('function');
      expect(typeof adapter.update).toBe('function');
      expect(typeof adapter.end).toBe('function');
    }
  });

  it('always includes self in configured channels', () => {
    const configured = getConfiguredChannels();
    expect(configured).toContain('self');
  });

  it('omits eBay/Etsy/Amazon when their credentials are missing', () => {
    const configured = getConfiguredChannels();
    // In test env none of EBAY/ETSY/AMAZON env vars are set
    expect(configured).not.toContain('ebay_de');
    expect(configured).not.toContain('etsy_de');
    expect(configured).not.toContain('amazon_de');
  });
});
