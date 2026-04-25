import './setup';
import { telegramFileSig, signedTelegramImageUrl } from '../lib/telegram/image-proxy';

describe('telegram image proxy signatures', () => {
  it('produces deterministic signatures for the same fileId', async () => {
    const a = await telegramFileSig('abc');
    const b = await telegramFileSig('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different signatures for different fileIds', async () => {
    const a = await telegramFileSig('a');
    const b = await telegramFileSig('b');
    expect(a).not.toBe(b);
  });

  it('rotating NEXTAUTH_SECRET invalidates signatures', async () => {
    const before = await telegramFileSig('same');
    const original = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = 'y'.repeat(32);
    try {
      const after = await telegramFileSig('same');
      expect(after).not.toBe(before);
    } finally {
      process.env.NEXTAUTH_SECRET = original;
    }
  });

  it('signed URL includes sig query parameter and the fileId', async () => {
    const url = await signedTelegramImageUrl('xyz');
    expect(url).toContain('/api/images/telegram/xyz?sig=');
  });

  it('URL-encodes weird fileIds', async () => {
    const url = await signedTelegramImageUrl('a/b c');
    expect(url).toContain('a%2Fb%20c');
  });
});
