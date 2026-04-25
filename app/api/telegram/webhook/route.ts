/**
 * /api/telegram/webhook
 *
 * Telegram Bot API webhook. Verifies X-Telegram-Bot-Api-Secret-Token
 * timing-safely and restricts to allowed chat IDs. Update IDs are
 * deduplicated via webhook_events to defang Telegram's at-least-once
 * delivery semantics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { handleUpdate, telegramUpdateSchema } from '@/lib/telegram/router';
import { isAllowedChat } from '@/lib/telegram/bot';
import { recordWebhookEvent } from '@/lib/idempotency';
import { logger, errorContext } from '@/lib/logger';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function POST(req: NextRequest) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 503 });
  }

  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!timingSafeEqual(headerSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }
  const update = parsed.data;

  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!isAllowedChat(chatId)) {
    return NextResponse.json({ ok: true });
  }

  const fresh = await recordWebhookEvent('telegram', String(update.update_id));
  if (!fresh) return NextResponse.json({ ok: true, deduped: true });

  try {
    await handleUpdate(update);
  } catch (err) {
    logger.error('telegram webhook: handler failed', errorContext(err));
  }

  return NextResponse.json({ ok: true });
}
