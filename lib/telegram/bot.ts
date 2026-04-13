/**
 * lib/telegram/bot.ts — thin wrapper over Telegram Bot API via fetch
 */

import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/marketplaces/fetch';

const API_BASE = 'https://api.telegram.org';

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function tgFetch<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const res = await fetchWithTimeout(
    `${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    15_000,
  );
  const json = (await res.json()) as TelegramResponse<T>;
  if (!json.ok || !json.result) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result;
}

export interface SendMessageOptions {
  chatId: number;
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyMarkup?: unknown;
}

export async function sendMessage(opts: SendMessageOptions): Promise<void> {
  await tgFetch('sendMessage', {
    chat_id: opts.chatId,
    text: opts.text,
    parse_mode: opts.parseMode,
    reply_markup: opts.replyMarkup,
    disable_web_page_preview: true,
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await tgFetch('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
}

export async function getFile(fileId: string): Promise<string> {
  const file = await tgFetch<TelegramFile>('getFile', { file_id: fileId });
  if (!file.file_path) throw new Error('Telegram getFile returned no file_path');
  return `${API_BASE}/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
}

export function isAllowedChat(chatId: number | undefined): boolean {
  if (chatId == null) return false;
  const list = env.TELEGRAM_ADMIN_CHAT_IDS;
  if (!list) return false;
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(chatId));
}
