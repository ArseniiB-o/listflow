/**
 * Test environment shim — populates the env vars validated by lib/env.ts so
 * importing modules don't crash during unit tests.
 */

// `NODE_ENV` is readonly in @types/node 22+; assign through `as` to bypass.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.NEXTAUTH_SECRET = 'x'.repeat(32);
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
