/**
 * lib/telegram/router.ts
 *
 * Command handler for incoming Telegram updates:
 *   /new       → create empty draft, ask for photos + note
 *   photo      → append url to draft images
 *   text       → set userText (and /price 35 sets price)
 *   /generate  → call AI engine, save generated, show preview
 *   /publish   → create product row + publish to all configured channels
 *   /cancel    → clear draft
 */

import 'server-only';
import { z } from 'zod';
import { sendMessage, answerCallbackQuery } from './bot';
import { signedTelegramImageUrl } from './image-proxy';
import { getDraft, saveDraft, clearDraft } from './session';
import { generateContent, BudgetExceededError } from '@/lib/ai/content-engine';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishProduct } from '@/lib/marketplaces/publish';
import { getConfiguredChannels } from '@/lib/marketplaces/registry';
import { env } from '@/lib/env';
import { nanoid } from 'nanoid';

// ── Telegram update schema ──────────────────────────────────────────────────

const tgPhotoSizeSchema = z.object({
  file_id: z.string(),
  width: z.number(),
  height: z.number(),
});

const tgMessageSchema = z.object({
  message_id: z.number(),
  chat: z.object({ id: z.number() }),
  text: z.string().max(4096).optional(),
  caption: z.string().max(1024).optional(),
  photo: z.array(tgPhotoSizeSchema).optional(),
});

const tgCallbackSchema = z.object({
  id: z.string(),
  data: z.string().max(64).optional(),
  message: tgMessageSchema.optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: tgMessageSchema.optional(),
  callback_query: tgCallbackSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
type TgMessage = z.infer<typeof tgMessageSchema>;
type TgCallbackQuery = z.infer<typeof tgCallbackSchema>;
type TgPhotoSize = z.infer<typeof tgPhotoSizeSchema>;

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function slugFrom(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'item'}-${nanoid(6).toLowerCase()}`;
}

async function uniqueSlug(
  supabase: ReturnType<typeof createAdminClient>,
  title: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = slugFrom(title);
    const { data } = await supabase
      .from('products')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${slugFrom(title)}-${nanoid(4).toLowerCase()}`;
}

function pickLargestPhoto(photos: TgPhotoSize[]): TgPhotoSize | undefined {
  if (!photos.length) return undefined;
  return [...photos].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? '').trim();

  if (text.startsWith('/new')) {
    await clearDraft(chatId);
    await saveDraft({ chatId, stage: 'collecting', images: [], userText: '', category: 'general' });
    await sendMessage({
      chatId,
      text:
        'New product. Send 1-10 photos and a short description (what it is, materials, size, price if you know).\n' +
        'Then type /generate to create title + description in DE and EN.\n' +
        'To change category: /category candle | painting | decor',
    });
    return;
  }

  if (text.startsWith('/cancel')) {
    await clearDraft(chatId);
    await sendMessage({ chatId, text: 'Draft cleared.' });
    return;
  }

  if (text.startsWith('/category')) {
    const category = text.replace('/category', '').trim() || 'general';
    const draft = await getDraft(chatId);
    await saveDraft({ ...draft, category });
    await sendMessage({ chatId, text: `Category: ${category}` });
    return;
  }

  if (text.startsWith('/price')) {
    const raw = text.replace('/price', '').trim().replace(',', '.');
    const priceEUR = Number(raw);
    if (!priceEUR || priceEUR <= 0) {
      await sendMessage({ chatId, text: 'Format: /price 35 (in EUR)' });
      return;
    }
    const draft = await getDraft(chatId);
    await saveDraft({ ...draft, priceEUR });
    await sendMessage({ chatId, text: `Price: €${priceEUR.toFixed(2)}` });
    return;
  }

  if (text.startsWith('/generate')) {
    await runGeneration(chatId);
    return;
  }

  if (text.startsWith('/preview')) {
    await runPreview(chatId);
    return;
  }

  if (text.startsWith('/publish')) {
    await runPublish(chatId);
    return;
  }

  const draft = await getDraft(chatId);
  if (draft.stage === 'idle') {
    await sendMessage({ chatId, text: 'Start with /new to create a new product.' });
    return;
  }

  let nextImages = draft.images;
  let nextText = draft.userText;

  const photo = msg.photo && pickLargestPhoto(msg.photo);
  if (photo) {
    try {
      // Persist a signed proxy URL — the bot token never lands in the DB or
      // in any marketplace listing's image array.
      const url = await signedTelegramImageUrl(photo.file_id);
      nextImages = [...nextImages, url].slice(0, 10);
    } catch {
      await sendMessage({ chatId, text: 'Failed to register photo, try again.' });
      return;
    }
  }
  if (text) {
    const merged = nextText ? `${nextText}\n${text}` : text;
    nextText = merged.slice(0, 4000);
  }

  await saveDraft({ ...draft, images: nextImages, userText: nextText });
  await sendMessage({
    chatId,
    text: `Got it. Photos: ${nextImages.length}, text: ${nextText.length} chars.\nType /generate when ready.`,
  });
}

async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  const chatId = cb.message?.chat.id;
  if (!chatId || !cb.data) return;
  await answerCallbackQuery(cb.id);

  if (cb.data === 'publish') {
    await runPublish(chatId);
  } else if (cb.data === 'cancel') {
    await clearDraft(chatId);
    await sendMessage({ chatId, text: 'Cancelled.' });
  } else if (cb.data === 'regenerate') {
    await runGeneration(chatId);
  }
}

async function runGeneration(chatId: number): Promise<void> {
  const draft = await getDraft(chatId);
  if (!draft.userText.trim() && draft.images.length === 0) {
    await sendMessage({ chatId, text: 'Send photos and/or text first.' });
    return;
  }
  await sendMessage({ chatId, text: 'Generating description...' });
  try {
    const generated = await generateContent({
      userText: draft.userText,
      imageUrls: draft.images,
      category: draft.category,
      locales: ['de', 'en'],
      targetChannels: ['self', 'ebay_de', 'etsy_de', 'amazon_de'],
      priceHintEUR: draft.priceEUR,
    });
    await saveDraft({ ...draft, stage: 'ready', generated });

    const preview =
      `DE: ${escapeMd(generated.title.de)}\n${escapeMd(generated.description.de.slice(0, 400))}\n\n` +
      `EN: ${escapeMd(generated.title.en)}\n${escapeMd(generated.description.en.slice(0, 400))}\n\n` +
      `Tags: ${generated.tags.de.slice(0, 6).map(escapeMd).join(', ')}\n` +
      (generated.priceSuggestionEUR ? `Suggested price: €${generated.priceSuggestionEUR.toFixed(2)}` : '');

    await sendMessage({
      chatId,
      text: preview,
      parseMode: 'MarkdownV2',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'Publish', callback_data: 'publish' },
            { text: 'Regenerate', callback_data: 'regenerate' },
            { text: 'Cancel', callback_data: 'cancel' },
          ],
        ],
      },
    });
  } catch (err: unknown) {
    if (err instanceof BudgetExceededError) {
      await sendMessage({
        chatId,
        text: `Daily AI budget exceeded (${err.usedCents}/${err.budgetCents} cents). Try tomorrow or increase AI_DAILY_BUDGET_CENTS.`,
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    await sendMessage({ chatId, text: `Generation failed: ${message}` });
  }
}

async function runPreview(chatId: number): Promise<void> {
  const draft = await getDraft(chatId);
  if (!draft.generated) {
    await sendMessage({ chatId, text: 'No generated content. Run /generate first.' });
    return;
  }
  const g = draft.generated;
  const previewText =
    `DE: ${escapeMd(g.title.de)}\n${escapeMd(g.description.de)}\n\n` +
    `EN: ${escapeMd(g.title.en)}\n${escapeMd(g.description.en)}\n\n` +
    `Tags DE: ${g.tags.de.map(escapeMd).join(', ')}\n` +
    `Tags EN: ${g.tags.en.map(escapeMd).join(', ')}\n` +
    (g.priceSuggestionEUR ? `${g.priceSuggestionEUR.toFixed(2)} EUR\n` : '') +
    `Materials: ${g.materialHints.map(escapeMd).join(', ')}`;
  await sendMessage({ chatId, text: previewText, parseMode: 'MarkdownV2' });
}

async function runPublish(chatId: number): Promise<void> {
  const draft = await getDraft(chatId);
  if (draft.stage === 'publishing') {
    await sendMessage({ chatId, text: 'Publishing in progress, please wait.' });
    return;
  }
  if (draft.stage !== 'ready' || !draft.generated) {
    await sendMessage({ chatId, text: 'Run /generate first, then /publish.' });
    return;
  }

  await saveDraft({ ...draft, stage: 'publishing' });

  const supabase = createAdminClient();
  const gen = draft.generated;
  const price = draft.priceEUR ?? gen.priceSuggestionEUR ?? 25;
  const slug = await uniqueSlug(supabase, gen.title.en);

  const { data: cat } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', draft.category)
    .maybeSingle<{ id: string }>();

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      slug,
      category_id: cat?.id ?? null,
      name: { de: gen.title.de, en: gen.title.en },
      description: { de: gen.description.de, en: gen.description.en },
      price,
      images: draft.images,
      stock_status: 'in_stock',
      stock_quantity: 1,
      is_active: true,
      details: {
        tags: gen.tags,
        materialHints: gen.materialHints,
        suggestedCategoryPath: gen.suggestedCategoryPath,
        source: 'telegram',
      },
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !product) {
    // Roll back to ready so the user can retry without re-running AI.
    await saveDraft({ ...draft, stage: 'ready' });
    await sendMessage({ chatId, text: 'Failed to create product in database. Try /publish again.' });
    return;
  }

  const channels = getConfiguredChannels();
  const results = await publishProduct({ productId: product.id, channels });

  const successLines = results.filter((r) => r.ok).map((r) => `${r.channel}${'externalUrl' in r && r.externalUrl ? ` — ${r.externalUrl}` : ''}`);
  const failLines = results.filter((r) => !r.ok).map((r) => `${r.channel}: ${'error' in r ? r.error : ''}`);

  await sendMessage({
    chatId,
    text:
      `Published to ${results.filter((r) => r.ok).length}/${results.length} channels.\n\n` +
      (successLines.length ? `OK:\n${successLines.join('\n')}\n\n` : '') +
      (failLines.length ? `Failed:\n${failLines.join('\n')}` : ''),
  });

  await clearDraft(chatId);
}
