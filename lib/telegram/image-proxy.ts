/**
 * lib/telegram/image-proxy.ts — token-free public URLs for Telegram photos.
 *
 * The bot token MUST NOT appear in any URL we persist or hand to a
 * marketplace, otherwise it leaks into Etsy/eBay listings via image_url.
 *
 * Flow:
 *   1. Bot stores `signedTelegramImageUrl(fileId)` in product.images.
 *   2. The marketplace fetches that URL via /api/images/telegram/<fileId>?sig=…
 *   3. Our route validates the HMAC, calls Telegram getFile + downloads,
 *      streams the bytes back without revealing the token.
 *
 * The HMAC key is NEXTAUTH_SECRET — rotating it invalidates all signed URLs.
 */

import 'server-only';

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function telegramFileSig(fileId: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET not configured');
  return hmacSha256Hex(secret, `tg:${fileId}`);
}

export async function signedTelegramImageUrl(fileId: string): Promise<string> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const sig = await telegramFileSig(fileId);
  return `${base}/api/images/telegram/${encodeURIComponent(fileId)}?sig=${sig}`;
}
