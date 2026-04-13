/**
 * lib/ai/content-engine.ts
 *
 * Turns a short user note + product photos into marketplace copy
 * (title, description, tags) in DE + EN using OpenRouter API.
 *
 * The underlying model can be swapped via OPENROUTER_MODEL env var.
 * Default: google/gemini-2.5-flash (fast, vision-capable, cheap).
 *
 * Every call is logged to ai_generation_log for cost + audit tracking.
 * A daily cost guard (AI_DAILY_BUDGET_CENTS) blocks further calls once
 * the budget is exhausted.
 */

import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Channel, Locale } from '@/lib/marketplaces/types';

// ── Public types ───────────────────────────────────────────────────────────

export interface GenerateInput {
  userText: string;
  imageUrls: string[];
  category: string;
  locales: Locale[];
  targetChannels: Channel[];
  priceHintEUR?: number;
  productId?: string;
}

export interface GeneratedContent {
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  tags: Record<Locale, string[]>;
  materialHints: string[];
  suggestedCategoryPath: Partial<Record<Channel, string>>;
  priceSuggestionEUR?: number;
}

// ── Per-channel constraints ─────────────────────────────────────────────────

const CHANNEL_LIMITS: Record<Channel, { titleMax: number; tagMax: number; tagCount: number }> = {
  self:      { titleMax: 120, tagMax: 32, tagCount: 15 },
  ebay_de:   { titleMax:  80, tagMax: 30, tagCount: 10 },
  etsy_de:   { titleMax: 140, tagMax: 20, tagCount: 13 },
  amazon_de: { titleMax: 200, tagMax: 50, tagCount: 15 },
};

function effectiveTitleLimit(channels: Channel[]): number {
  return channels.reduce((min, c) => Math.min(min, CHANNEL_LIMITS[c].titleMax), 200);
}

// ── Response schema ──────────────────────────────────────────────────────

const generatedContentSchema = z.object({
  title: z.object({ de: z.string().min(1), en: z.string().min(1) }),
  description: z.object({ de: z.string().min(1), en: z.string().min(1) }),
  tags: z.object({
    de: z.array(z.string().min(1)).min(1).max(20),
    en: z.array(z.string().min(1)).min(1).max(20),
  }),
  materialHints: z.array(z.string()).default([]),
  suggestedCategoryPath: z.record(z.string(), z.string()).default({}),
  priceSuggestionEUR: z.number().positive().optional(),
});

type ParsedContent = z.infer<typeof generatedContentSchema>;

// ── Brand voice loader ──────────────────────────────────────────────────────

interface BrandVoiceSample {
  title: string;
  description: string;
  tags: string[];
  locale: Locale;
}

async function loadBrandVoice(category: string, locales: Locale[]): Promise<BrandVoiceSample[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('brand_voice_samples')
    .select('title, description, tags, locale')
    .eq('category', category)
    .in('locale', locales)
    .eq('is_active', true)
    .limit(6);

  if (error || !data) return [];
  return data as BrandVoiceSample[];
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildSystemPrompt(category: string, samples: BrandVoiceSample[], titleLimit: number): string {
  const sampleBlock = samples.length
    ? samples
        .map(
          (s, i) =>
            `Example ${i + 1} (${s.locale}):\nTitle: ${s.title}\nDescription: ${s.description}\nTags: ${s.tags.join(', ')}`,
        )
        .join('\n\n')
    : '(no prior samples — establish a warm, artisanal, understated tone)';

  return `You are a product copywriter for an e-commerce store.
Your output must match the house voice shown in the examples below.

House voice characteristics:
- Warm, artisanal, confident without being salesy
- Sensory: evoke texture, scent, light, materials
- Concrete: name materials and techniques when visible
- Short paragraphs, no bullet-point lists, no emoji
- German copy uses "Sie" (formal) unless the examples show otherwise

Constraints:
- Category: ${category}
- Title MUST be <= ${titleLimit} characters in every locale
- Tags are single words or 2-word phrases, lowercase
- Respond ONLY with a single valid JSON object matching the schema. No prose, no markdown fences.

Brand voice examples:
${sampleBlock}`;
}

function buildUserPrompt(input: GenerateInput): string {
  const priceLine = input.priceHintEUR
    ? `\nPrice hint from seller: €${input.priceHintEUR.toFixed(2)}`
    : '';
  return `Seller's short note (may be in any language — translate as needed):
"""
${input.userText}
"""${priceLine}
Target channels: ${input.targetChannels.join(', ')}
Locales to produce: ${input.locales.join(', ')}

Look at the attached photos to identify materials, colours, approximate size, and technique.

Produce this exact JSON shape (all fields required unless marked optional):
{
  "title": { "de": "...", "en": "..." },
  "description": { "de": "...", "en": "..." },
  "tags":  { "de": ["..."], "en": ["..."] },
  "materialHints": ["wax", "cotton wick", "..."],
  "suggestedCategoryPath": {
    "ebay_de":   "category path or ID",
    "etsy_de":   "taxonomy ID",
    "amazon_de": "category path"
  },
  "priceSuggestionEUR": 42.0
}`;
}

// ── OpenRouter API call ───────────────────────────────────────────────────

interface OpenRouterChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const PRICE_TABLE_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  'google/gemini-2.5-flash': { input: 30, output: 250 },
  'google/gemini-flash-1.5': { input: 7.5, output: 30 },
  'openai/gpt-4o-mini':      { input: 15, output: 60 },
  'anthropic/claude-3.5-haiku': { input: 80, output: 400 },
  'anthropic/claude-sonnet-4.5': { input: 300, output: 1500 },
};

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICE_TABLE_CENTS_PER_MTOK).find((m) => model.startsWith(m));
  const price = key ? PRICE_TABLE_CENTS_PER_MTOK[key] : { input: 100, output: 500 };
  const cents = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.max(1, Math.round(cents));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(
  system: string,
  userPrompt: string,
  imageUrls: string[],
): Promise<{ parsed: ParsedContent; model: string; latencyMs: number; inputTokens: number; outputTokens: number }> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const userContent: Array<Record<string, unknown>> = imageUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));
  userContent.push({ type: 'text', text: userPrompt });

  const body = {
    model: env.OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: 2048,
    temperature: 0.4,
    response_format: { type: 'json_object' },
  };

  const started = Date.now();
  const res = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'http-referer': env.OPENROUTER_APP_URL ?? env.NEXTAUTH_URL,
        'x-title': env.OPENROUTER_APP_NAME,
      },
      body: JSON.stringify(body),
    },
    45_000,
  );
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`);
  }

  const raw = (await res.json()) as OpenRouterResponse;
  const text = raw.choices?.[0]?.message?.content ?? '';
  const jsonText = extractJson(text);
  let parsed: ParsedContent;
  try {
    parsed = generatedContentSchema.parse(JSON.parse(jsonText));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'parse error';
    throw new Error(`AI output did not match schema: ${msg}`);
  }
  return {
    parsed,
    model: raw.model ?? env.OPENROUTER_MODEL,
    latencyMs,
    inputTokens: raw.usage?.prompt_tokens ?? 0,
    outputTokens: raw.usage?.completion_tokens ?? 0,
  };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

// ── Length enforcement ──────────────────────────────────────────────────

function truncateTo(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

function enforceLimits(content: ParsedContent, titleLimit: number): ParsedContent {
  return {
    ...content,
    title: {
      de: truncateTo(content.title.de, titleLimit),
      en: truncateTo(content.title.en, titleLimit),
    },
  };
}

// ── Image URL guard (SSRF protection) ───────────────────────────────────

function assertImageUrlsSafe(urls: string[]): void {
  if (urls.length > 10) throw new Error('Too many images (max 10)');
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`Invalid image URL: ${u.slice(0, 64)}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Image URL must be http(s): ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    const BLOCKED = /^(localhost|0\.0\.0\.0|127\.\d|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fd[0-9a-f]{2}:|\[::1\])/i;
    if (BLOCKED.test(host)) {
      throw new Error(`Blocked private/reserved host: ${host}`);
    }
  }
}

// ── Daily budget guard ─────────────────────────────────────────────────

async function todayCostCents(): Promise<number> {
  const supabase = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('ai_generation_log')
    .select('cost_usd_cents.sum()')
    .gte('created_at', startOfDay.toISOString())
    .single();

  return (data as unknown as { sum: number | null })?.sum ?? 0;
}

export class BudgetExceededError extends Error {
  constructor(public readonly usedCents: number, public readonly budgetCents: number) {
    super(`AI daily budget exceeded (${usedCents}/${budgetCents} cents)`);
    this.name = 'BudgetExceededError';
  }
}

// ── Logging ─────────────────────────────────────────────────────────────

interface LogParams {
  productId?: string;
  kind: 'all' | 'rewrite';
  model: string;
  input: GenerateInput;
  output: ParsedContent;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costCents: number;
}

async function logGeneration(params: LogParams): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('ai_generation_log').insert({
    product_id: params.productId ?? null,
    kind: params.kind,
    model: params.model,
    input: { ...params.input, imageUrls: params.input.imageUrls.length },
    output: params.output,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd_cents: params.costCents,
    latency_ms: params.latencyMs,
  });
}

// ── Public entry point ─────────────────────────────────────────────────

export async function generateContent(input: GenerateInput): Promise<GeneratedContent> {
  if (!input.userText.trim() && input.imageUrls.length === 0) {
    throw new Error('generateContent requires at least userText or imageUrls');
  }
  if (input.userText.length > 4000) {
    throw new Error('userText exceeds 4000 characters');
  }
  if (input.locales.length === 0) {
    throw new Error('generateContent requires at least one locale');
  }
  assertImageUrlsSafe(input.imageUrls);

  const used = await todayCostCents();
  if (used >= env.AI_DAILY_BUDGET_CENTS) {
    throw new BudgetExceededError(used, env.AI_DAILY_BUDGET_CENTS);
  }

  const samples = await loadBrandVoice(input.category, input.locales);
  const titleLimit = effectiveTitleLimit(input.targetChannels);
  const system = buildSystemPrompt(input.category, samples, titleLimit);
  const user = buildUserPrompt(input);

  const { parsed, model, latencyMs, inputTokens, outputTokens } = await callOpenRouter(system, user, input.imageUrls);
  const constrained = enforceLimits(parsed, titleLimit);

  const costCents = estimateCostCents(model, inputTokens, outputTokens);

  await logGeneration({
    productId: input.productId,
    kind: 'all',
    model,
    input,
    output: constrained,
    inputTokens,
    outputTokens,
    latencyMs,
    costCents,
  });

  return {
    title: constrained.title,
    description: constrained.description,
    tags: constrained.tags,
    materialHints: constrained.materialHints ?? [],
    suggestedCategoryPath: constrained.suggestedCategoryPath as Partial<Record<Channel, string>>,
    priceSuggestionEUR: constrained.priceSuggestionEUR,
  };
}

export const __internal = {
  buildSystemPrompt,
  buildUserPrompt,
  enforceLimits,
  extractJson,
  effectiveTitleLimit,
  estimateCostCents,
  assertImageUrlsSafe,
  CHANNEL_LIMITS,
};
