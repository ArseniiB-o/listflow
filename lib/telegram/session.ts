/**
 * lib/telegram/session.ts — per-chat draft state persisted in Supabase
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { GeneratedContent } from '@/lib/ai/content-engine';

export type DraftStage = 'idle' | 'collecting' | 'ready' | 'publishing';

export interface DraftState {
  chatId: number;
  stage: DraftStage;
  images: string[];
  userText: string;
  category: string;
  priceEUR?: number;
  generated?: GeneratedContent;
}

interface DraftRow {
  chat_id: number;
  stage: DraftStage;
  images: string[];
  user_text: string;
  category: string;
  price_eur: string | number | null;
  generated: GeneratedContent | null;
}

function rowToState(row: DraftRow): DraftState {
  return {
    chatId: Number(row.chat_id),
    stage: row.stage,
    images: row.images ?? [],
    userText: row.user_text ?? '',
    category: row.category ?? 'general',
    priceEUR: row.price_eur != null ? Number(row.price_eur) : undefined,
    generated: row.generated ?? undefined,
  };
}

export async function getDraft(chatId: number): Promise<DraftState> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('telegram_drafts')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle<DraftRow>();

  if (data) return rowToState(data);
  return { chatId, stage: 'idle', images: [], userText: '', category: 'general' };
}

export async function saveDraft(state: DraftState): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('telegram_drafts').upsert(
    {
      chat_id: state.chatId,
      stage: state.stage,
      images: state.images,
      user_text: state.userText,
      category: state.category,
      price_eur: state.priceEUR ?? null,
      generated: state.generated ?? null,
    },
    { onConflict: 'chat_id' },
  );
}

export async function clearDraft(chatId: number): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('telegram_drafts').delete().eq('chat_id', chatId);
}

export async function sweepStaleDrafts(maxAgeHours = 24): Promise<number> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('telegram_drafts')
    .delete({ count: 'exact' })
    .lt('updated_at', cutoff);
  if (error) return 0;
  return count ?? 0;
}
