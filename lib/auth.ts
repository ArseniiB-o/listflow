/**
 * lib/auth.ts — Admin authentication for API routes.
 *
 * Two supported modes (in priority order):
 *   1. Bearer token: `Authorization: Bearer ${ADMIN_API_TOKEN}` — for service-to-service
 *      automation. Token MUST be at least 32 chars, configured via ADMIN_API_TOKEN env.
 *   2. Cookie session: sb-access-token signed by Supabase auth → email must be in
 *      ADMIN_EMAILS allowlist.
 *
 * If neither ADMIN_API_TOKEN nor ADMIN_EMAILS is configured, the admin API
 * is locked down completely (deny-all) — fail-closed.
 */

import 'server-only';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function adminApiToken(): string | null {
  const t = process.env.ADMIN_API_TOKEN;
  if (!t || t.length < 32) return null;
  return t;
}

function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  // 1. Bearer token (preferred for automation/CLI)
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const expected = adminApiToken();
    if (!expected) return false;
    const provided = auth.slice('Bearer '.length).trim();
    if (timingSafeEqual(provided, expected)) return true;
  }

  // 2. Supabase session cookie
  const allowlist = adminEmails();
  if (allowlist.length === 0) return false;

  const accessToken = req.cookies.get('sb-access-token')?.value;
  if (!accessToken) return false;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user?.email) return false;
    return allowlist.includes(data.user.email.toLowerCase());
  } catch (err) {
    logger.warn('admin auth: failed to verify session', { error: String(err) });
    return false;
  }
}

/**
 * Minimal in-memory rate limiter for admin endpoints.
 * Per process — fine for single-instance deploys; for multi-region use Upstash Redis.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  if (bucket.count > limit) return false;
  return true;
}

export function clientKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anon'
  );
}
