/**
 * lib/logger.ts — minimal JSON-line structured logger.
 *
 * Edge & Node compatible, no external deps. Use instead of console.log.
 *
 * Output format:
 *   {"level":"info","time":"2026-04-25T10:00:00Z","msg":"…","ctx":{…}}
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentMinLevel(): number {
  const raw = (typeof process !== 'undefined' ? process.env.LOG_LEVEL : 'info') ?? 'info';
  const lower = raw.toLowerCase() as Level;
  return LEVEL_RANK[lower] ?? LEVEL_RANK.info;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"<unserializable>"';
  }
}

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < currentMinLevel()) return;
  const line = `{"level":"${level}","time":"${new Date().toISOString()}","msg":${safeJson(msg)}${
    ctx ? `,"ctx":${safeJson(ctx)}` : ''
  }}`;
  // stderr for warn+, stdout for info-
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};

export function errorContext(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { error: err.message, name: err.name, stack: err.stack?.split('\n').slice(0, 5).join('\n') };
  }
  return { error: String(err) };
}
