import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureSchedule, qstashConfigured } from './qstash';

/**
 * These lock in the property the additive design rests on: on a deployment that does not use
 * QStash, none of this does anything. A regression here would have an on-prem box try to reach
 * Upstash on every boot — the opposite of "a school's server phones nobody".
 *
 * `ensureSchedule` is only exercised for its refusals. Registering a schedule is a network call to
 * Upstash, and a test that reached the real service would be a test that fails on an aeroplane.
 */
const VARS = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'API_PUBLIC_URL'] as const;

const noopLog = { log: () => undefined, warn: () => undefined };

describe('qstash configuration', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it('reports itself unconfigured with no signing key', () => {
    expect(qstashConfigured()).toBe(false);
  });

  it('reports itself configured once a signing key is present', () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'sig_test';
    expect(qstashConfigured()).toBe(true);
  });

  it('registers nothing when QStash is not configured at all', async () => {
    await expect(
      ensureSchedule({ scheduleId: 'x', path: '/x', cron: '* * * * *', log: noopLog }),
    ).resolves.toBe(false);
  });

  it('registers nothing when there is a token but no address to call back to', async () => {
    // The failure this prevents is a schedule pointing at localhost, which fails silently once a
    // day rather than loudly at boot.
    process.env.QSTASH_TOKEN = 'tok_test';
    await expect(
      ensureSchedule({ scheduleId: 'x', path: '/x', cron: '* * * * *', log: noopLog }),
    ).resolves.toBe(false);
  });

  it('says so when QStash is configured but has nowhere to call back to', async () => {
    // Half-configured must not be silent: it is somebody who meant to use QStash, and the symptom
    // otherwise is a job that never runs and never explains why. Cost a deploy to work out once.
    const warnings: string[] = [];
    process.env.QSTASH_TOKEN = 'tok_test';
    await ensureSchedule({
      scheduleId: 'the-sweep',
      path: '/x',
      cron: '* * * * *',
      log: { log: () => undefined, warn: (m) => warnings.push(m) },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('API_PUBLIC_URL');
    expect(warnings[0]).toContain('the-sweep');
  });

  it('stays silent where QStash is simply not in use', async () => {
    // The on-prem case. A school's server must not log about a service it does not talk to.
    const warnings: string[] = [];
    await ensureSchedule({
      scheduleId: 'x',
      path: '/x',
      cron: '* * * * *',
      log: { log: () => undefined, warn: (m) => warnings.push(m) },
    });
    expect(warnings).toEqual([]);
  });

  it('registers nothing when there is an address but no token', async () => {
    // A replica given only the signing keys answers callbacks; it must not re-point the schedules
    // at itself.
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'sig_test';
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    await expect(
      ensureSchedule({ scheduleId: 'x', path: '/x', cron: '* * * * *', log: noopLog }),
    ).resolves.toBe(false);
  });
});
