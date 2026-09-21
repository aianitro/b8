import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLogLine, createLogger } from './logger';

describe('formatLogLine', () => {
  it('includes the ISO time from the injected clock', () => {
    const fixed = new Date('2026-08-06T12:00:00.000Z');
    const line = formatLogLine('info', 'sync', 'plain sync phase', {}, () => fixed);
    expect(line.time).toBe('2026-08-06T12:00:00.000Z');
  });

  it('carries level, scope, and message through unchanged', () => {
    const line = formatLogLine('warn', 'plaidReconcile', 'could not confidently reconcile');
    expect(line.level).toBe('warn');
    expect(line.scope).toBe('plaidReconcile');
    expect(line.message).toBe('could not confidently reconcile');
  });

  it('merges extra fields onto the line', () => {
    const line = formatLogLine('error', 'sync', 'item failed', { accountIds: ['a', 'b'], error: 'boom' });
    expect(line.accountIds).toEqual(['a', 'b']);
    expect(line.error).toBe('boom');
  });

  it('defaults to no extra fields', () => {
    const line = formatLogLine('info', 'scheduler', 'daily Plaid sync scheduled');
    expect(Object.keys(line).sort()).toEqual(['level', 'message', 'scope', 'time']);
  });
});

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes info to console.log as a single JSON line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createLogger('sync').info('plain sync phase', { added: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ level: 'info', scope: 'sync', message: 'plain sync phase', added: 3 });
  });

  it('routes warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createLogger('plaidReconcile').warn('remapped account ids', { remapped: ['a->b'] });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ level: 'warn', scope: 'plaidReconcile', message: 'remapped account ids' });
  });

  it('routes error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createLogger('chat').error('request failed', { error: 'timeout' });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ level: 'error', scope: 'chat', message: 'request failed', error: 'timeout' });
  });
});
