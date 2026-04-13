/**
 * /api/telegram/webhook
 *
 * Telegram Bot API webhook. Verifies X-Telegram-Bot-Api-Secret-Token
 * and restricts to allowed chat IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { handleUpdate, telegramUpdateSchema } from '@/lib/telegram/router';
import { isAllowedChat } from '@/lib/telegram/bot';

export async function POST(req: NextRequest) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 503 });
  }

  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (headerSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
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

  try {
    await handleUpdate(update);
  } catch (err: unknown) {
    console.error('[telegram webhook]', err);
  }

  return NextResponse.json({ ok: true });
}
