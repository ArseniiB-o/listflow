import './setup';
import { NextRequest } from 'next/server';
import { isAdminRequest, rateLimit } from '../lib/auth';

function makeReq(headers: Record<string, string>, cookies: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (cookieHeader) h.set('cookie', cookieHeader);
  return new NextRequest('http://localhost/api/admin/anything', { headers: h });
}

describe('isAdminRequest', () => {
  const original = { token: process.env.ADMIN_API_TOKEN, emails: process.env.ADMIN_EMAILS };

  afterEach(() => {
    process.env.ADMIN_API_TOKEN = original.token;
    process.env.ADMIN_EMAILS = original.emails;
  });

  it('denies when neither ADMIN_API_TOKEN nor ADMIN_EMAILS configured', async () => {
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.ADMIN_EMAILS;
    const req = makeReq({});
    expect(await isAdminRequest(req)).toBe(false);
  });

  it('denies when ADMIN_API_TOKEN is configured but missing from request', async () => {
    process.env.ADMIN_API_TOKEN = 'a'.repeat(32);
    const req = makeReq({});
    expect(await isAdminRequest(req)).toBe(false);
  });

  it('denies on Bearer mismatch', async () => {
    process.env.ADMIN_API_TOKEN = 'a'.repeat(32);
    const req = makeReq({ authorization: `Bearer ${'b'.repeat(32)}` });
    expect(await isAdminRequest(req)).toBe(false);
  });

  it('accepts a matching Bearer token', async () => {
    process.env.ADMIN_API_TOKEN = 'a'.repeat(32);
    const req = makeReq({ authorization: `Bearer ${'a'.repeat(32)}` });
    expect(await isAdminRequest(req)).toBe(true);
  });

  it('rejects ADMIN_API_TOKEN under 32 chars (treats as not configured)', async () => {
    process.env.ADMIN_API_TOKEN = 'short';
    const req = makeReq({ authorization: 'Bearer short' });
    expect(await isAdminRequest(req)).toBe(false);
  });
});

describe('rateLimit', () => {
  it('allows up to N requests per window then blocks', () => {
    const k = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(false);
  });

  it('uses independent buckets per key', () => {
    expect(rateLimit('a-bucket', 1, 60_000)).toBe(true);
    expect(rateLimit('a-bucket', 1, 60_000)).toBe(false);
    expect(rateLimit('b-bucket', 1, 60_000)).toBe(true);
  });
});
