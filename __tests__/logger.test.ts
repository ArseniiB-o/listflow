import './setup';
import { logger, errorContext } from '../lib/logger';

describe('logger', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('emits one JSON line per call', () => {
    logger.info('hello', { a: 1 });
    expect(stdout).toHaveBeenCalledTimes(1);
    const line = stdout.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.ctx).toEqual({ a: 1 });
    expect(typeof parsed.time).toBe('string');
  });

  it('routes warn/error to stderr', () => {
    logger.warn('warn');
    logger.error('boom');
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  it('respects LOG_LEVEL', () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      logger.info('skipped');
      logger.warn('kept');
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledTimes(1);
    } finally {
      process.env.LOG_LEVEL = original;
    }
  });

  it('errorContext extracts useful fields from Error', () => {
    const ctx = errorContext(new Error('boom'));
    expect(ctx.error).toBe('boom');
    expect(ctx.name).toBe('Error');
    expect(typeof ctx.stack).toBe('string');
  });

  it('errorContext stringifies non-Error values', () => {
    expect(errorContext('weird')).toEqual({ error: 'weird' });
    expect(errorContext(42)).toEqual({ error: '42' });
  });
});
