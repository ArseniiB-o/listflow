/**
 * lib/env.ts — Validated, typed environment variables
 *
 * All required env vars are validated at startup.
 * Usage: import { env } from '@/lib/env'
 *
 * NEVER use process.env.VARIABLE directly in application code.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  // NextAuth
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // App
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  BRAND_NAME: z.string().min(1).default('My Store'),
  ADMIN_EMAILS: z.string().min(1).optional(),

  // AI — OpenRouter unifies Claude / Gemini / GPT behind one API
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).default('google/gemini-2.5-flash'),
  OPENROUTER_APP_URL: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().min(1).default('ListFlow'),

  // Daily cost cap for AI calls (USD cents)
  AI_DAILY_BUDGET_CENTS: z.coerce.number().int().positive().default(500),

  // eBay
  EBAY_OAUTH_TOKEN: z.string().min(1).optional(),
  EBAY_WEBHOOK_VERIFICATION_TOKEN: z.string().min(32).optional(),
  EBAY_FULFILLMENT_POLICY_ID: z.string().min(1).optional(),
  EBAY_PAYMENT_POLICY_ID: z.string().min(1).optional(),
  EBAY_RETURN_POLICY_ID: z.string().min(1).optional(),
  EBAY_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),

  // Etsy
  ETSY_API_KEY: z.string().min(1).optional(),
  ETSY_OAUTH_TOKEN: z.string().min(1).optional(),
  ETSY_SHOP_ID: z.string().min(1).optional(),
  ETSY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Amazon
  AMAZON_SELLER_ID: z.string().min(1).optional(),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  TELEGRAM_ADMIN_CHAT_IDS: z.string().min(1).optional(),

  // Cron (Upstash QStash)
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `\n[env] Environment variable validation failed:\n${issues}\n\n` +
        'Copy .env.example to .env.local and fill in all required values.',
    );
  }

  return parsed.data;
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
