import { describe, expect, it, vi } from 'vitest';
import { heartbeatPayload, sendHeartbeat, type HeartbeatPayload } from './heartbeat';
import type { LicencePayload, LicenceStatus } from './licence';

const licence = (over: Partial<LicencePayload> = {}): LicencePayload => ({
  v: 1,
  licenceId: 'lic_2026_0142',
  schoolName: 'Kwahu Ridge Academy',
  schoolSlug: 'kwahu-ridge-academy',
  tier: 'ADVANCED',
  studentCap: null,
  extraEntitlements: [],
  issuedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2027-07-01T00:00:00.000Z',
  graceDays: 30,
  ...over,
});

const status = (over: Partial<LicenceStatus> = {}): LicenceStatus => ({
  state: 'VALID',
  tier: 'ADVANCED',
  studentCap: null,
  extraEntitlements: [],
  payload: licence(),
  ...over,
});

describe('what the heartbeat says', () => {
  it('reports the licence, the package and one aggregate number', () => {
    const p = heartbeatPayload({
      status: status(),
      students: 412,
      verifiedWith: 'vendor',
      appVersion: '0.1.0',
    });
    expect(p).toMatchObject({
      v: 1,
      licenceId: 'lic_2026_0142',
      schoolSlug: 'kwahu-ridge-academy',
      state: 'VALID',
      tierInForce: 'ADVANCED',
      tierLicensed: 'ADVANCED',
      students: 412,
      verifiedWith: 'vendor',
    });
  });

  /**
   * The whole point of the feature. A lapsed licence still claims ADVANCED in its payload while
   * the box runs on BASIC — reporting both is how a vendor sees a school that has quietly stopped
   * renewing, without the box having to ask anyone's permission to keep working.
   */
  it('distinguishes what the licence bought from what is actually in force', () => {
    const p = heartbeatPayload({
      status: status({ state: 'EXPIRED', tier: 'BASIC', studentCap: 150 }),
      students: 412,
      verifiedWith: 'vendor',
      appVersion: '0.1.0',
    });
    expect(p.tierLicensed).toBe('ADVANCED');
    expect(p.tierInForce).toBe('BASIC');
    expect(p.students).toBeGreaterThan(p.studentCap!);
  });

  /**
   * The tamper signal. Signing cannot stop a school pointing the box at a key it made, but a
   * report saying so is a conversation worth having.
   */
  it('says which key the licence was verified against', () => {
    for (const v of ['vendor', 'development', 'none'] as const) {
      expect(
        heartbeatPayload({ status: status(), students: 1, verifiedWith: v, appVersion: '0.1.0' })
          .verifiedWith,
      ).toBe(v);
    }
  });

  it('copes with no licence installed at all', () => {
    const p = heartbeatPayload({
      status: { state: 'MISSING', tier: 'BASIC', studentCap: 150, extraEntitlements: [] },
      students: 0,
      verifiedWith: 'none',
      appVersion: '0.1.0',
    });
    expect(p.licenceId).toBeNull();
    expect(p.schoolSlug).toBeNull();
    expect(p.state).toBe('MISSING');
  });

  /**
   * The privacy guarantee, asserted rather than promised.
   *
   * This is a school management system: the database holds children's names, their guardians'
   * phone numbers, their marks and their fees. None of it may leave the school's server. Pinning
   * the exact key set means adding a field to the payload fails this test, which is precisely the
   * moment someone should have to think about it.
   */
  it('sends these fields and no others', () => {
    const p = heartbeatPayload({
      status: status(),
      students: 412,
      verifiedWith: 'vendor',
      appVersion: '0.1.0',
    });
    expect(Object.keys(p).sort()).toEqual(
      [
        'appVersion',
        'licenceId',
        'schoolSlug',
        'sentAt',
        'state',
        'studentCap',
        'students',
        'tierInForce',
        'tierLicensed',
        'v',
        'verifiedWith',
      ].sort(),
    );
  });

  it('carries nothing about any child, guardian or member of staff', () => {
    const p = heartbeatPayload({
      status: status(),
      students: 412,
      verifiedWith: 'vendor',
      appVersion: '0.1.0',
    });
    const serialised = JSON.stringify(p).toLowerCase();
    for (const forbidden of ['name', 'phone', 'email', 'address', 'guardian', 'student"', 'mark']) {
      // `students` (the count) is allowed; a `student"` key or a name field is not.
      if (forbidden === 'name') {
        expect(serialised).not.toContain('schoolname');
        expect(serialised).not.toContain('firstname');
        continue;
      }
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('sending it', () => {
  const payload = () =>
    heartbeatPayload({
      status: status(),
      students: 1,
      verifiedWith: 'vendor',
      appVersion: '0.1.0',
    }) as HeartbeatPayload;

  it('posts JSON to the configured URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const r = await sendHeartbeat('https://vendor.example/hb', payload(), {
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://vendor.example/hb');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).licenceId).toBe('lic_2026_0142');
  });

  /**
   * Offline is a supported deployment, not a fault. A LAN box with no route out must get a quiet
   * `ok: false` rather than an exception that surfaces anywhere near a school's morning.
   */
  it('reports a failure calmly when the supplier cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const r = await sendHeartbeat('https://vendor.example/hb', payload(), {
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('ENOTFOUND');
  });

  it('treats a non-2xx as a failure without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const r = await sendHeartbeat('https://vendor.example/hb', payload(), {
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('503');
  });

  it('gives up rather than holding a connection open all day', async () => {
    const fetchImpl = vi.fn((_u: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const r = await sendHeartbeat('https://vendor.example/hb', payload(), {
      timeoutMs: 20,
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(false);
  });
});
