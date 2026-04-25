/**
 * /api/images/telegram/[fileId]
 *
 * Image proxy for Telegram-uploaded photos. The bot token NEVER appears in
 * URLs persisted to the database or sent to marketplaces — this route does
 * the token-bearing fetch server-side and streams the bytes back.
 *
 * Auth: HMAC-SHA-256 signature in `?sig=` proves the URL was minted by us.
 *
 * Lifetime: signatures are bound to NEXTAUTH_SECRET; rotate the secret to
 * invalidate every minted URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { telegramFileSig, signedTelegramImageUrl } from '@/lib/telegram/image-proxy';
import { fetchWithTimeout } from '@/lib/marketplaces/fetch';
import { logger, errorContext } from '@/lib/logger';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ fileId: string }>;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(req: NextRequest, { params }: RouteContext) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram not configured' }, { status: 503 });
  }

  const { fileId } = await params;
  const sig = req.nextUrl.searchParams.get('sig') ?? '';
  const expected = await telegramFileSig(fileId);
  if (!sig || sig !== expected) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    // Resolve file_path with a server-side getFile call.
    const fileMeta = await fetchWithTimeout(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { method: 'GET' },
      15_000,
    );
    if (!fileMeta.ok) return NextResponse.json({ error: 'getFile failed' }, { status: 502 });
    const meta = (await fileMeta.json()) as { ok: boolean; result?: { file_path?: string } };
    if (!meta.ok || !meta.result?.file_path) {
      return NextResponse.json({ error: 'getFile returned no path' }, { status: 502 });
    }

    const fileRes = await fetchWithTimeout(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`,
      { method: 'GET' },
      30_000,
    );
    if (!fileRes.ok) return NextResponse.json({ error: 'file fetch failed' }, { status: 502 });

    const ct = fileRes.headers.get('content-type') ?? 'application/octet-stream';
    if (!ALLOWED_CONTENT_TYPES.has(ct.split(';')[0]!.trim())) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 });
    }
    const lengthHeader = fileRes.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_BYTES) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }

    return new NextResponse(fileRes.body, {
      status: 200,
      headers: {
        'content-type': ct,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    logger.error('telegram image proxy: failed', errorContext(err));
    return NextResponse.json({ error: 'Proxy failure' }, { status: 502 });
  }
}

