import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateContent, BudgetExceededError } from '@/lib/ai/content-engine';
import { ALL_CHANNELS, type Channel } from '@/lib/marketplaces/types';
import { env } from '@/lib/env';
import { isAdminRequest, rateLimit, clientKey } from '@/lib/auth';
import { logger, errorContext } from '@/lib/logger';

const generateSchema = z.object({
  userText: z.string().min(1).max(4000),
  imageUrls: z.array(z.string().url()).max(10),
  category: z.string().min(1).max(64),
  locales: z.array(z.enum(['de', 'en'])).min(1).default(['de', 'en']),
  targetChannels: z
    .array(z.enum(ALL_CHANNELS as unknown as [Channel, ...Channel[]]))
    .min(1)
    .default(['self', 'ebay_de', 'etsy_de']),
  priceHintEUR: z.number().positive().optional(),
  productId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!rateLimit(`admin-ai:${clientKey(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  if (!env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'AI content engine not configured (missing OPENROUTER_API_KEY)' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await generateContent(parsed.data);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: 'Daily AI budget exceeded', usedCents: err.usedCents, budgetCents: err.budgetCents },
        { status: 429 },
      );
    }
    logger.error('admin ai/generate: failed', errorContext(err));
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
