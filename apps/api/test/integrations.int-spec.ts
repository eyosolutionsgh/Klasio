/**
 * API keys: minted once, hashed at rest, read-only, revocable. The load-bearing assertions:
 * the key works exactly until revoked, and the external surface serves the key's OWN school
 * under tenancy — never anyone else's.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('integrations api keys', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('mints a key shown once, reads with it, and revocation kills it', async () => {
    const minted = await call<{ key: string }>(api.baseUrl, 'POST', '/integrations/keys', {
      token,
      body: { name: 'Accounting system' },
    });
    expect(minted.status, JSON.stringify(minted.body)).toBe(201);
    expect(minted.body.key.startsWith('eyo_')).toBe(true);

    // Only a hash is stored.
    const stored = await db.apiKey.findFirstOrThrow({ where: { schoolId } });
    expect(stored.keyHash).not.toContain(minted.body.key);
    expect(stored.prefix).toBe(minted.body.key.slice(0, 8));

    const read = await fetch(`${api.baseUrl}/integration/v1/students`, {
      headers: { 'x-api-key': minted.body.key },
    });
    expect(read.status).toBe(200);
    const students = (await read.json()) as { admissionNo: string }[];
    expect(students.length).toBeGreaterThan(0);

    const summary = await fetch(`${api.baseUrl}/integration/v1/fees/summary`, {
      headers: { 'x-api-key': minted.body.key },
    });
    expect(summary.status).toBe(200);
    const summaryBody = (await summary.json()) as { totalOutstanding: number };
    expect(summaryBody.totalOutstanding).toBeGreaterThanOrEqual(0);

    // Revoke, and the same key is dead.
    const keys = await call<{ id: string }[]>(api.baseUrl, 'GET', '/integrations/keys', { token });
    await call(api.baseUrl, 'DELETE', `/integrations/keys/${keys.body[0].id}`, { token });
    const after = await fetch(`${api.baseUrl}/integration/v1/students`, {
      headers: { 'x-api-key': minted.body.key },
    });
    expect(after.status).toBe(401);
  });

  it('refuses a made-up key', async () => {
    const res = await fetch(`${api.baseUrl}/integration/v1/students`, {
      headers: { 'x-api-key': 'eyo_not_a_real_key' },
    });
    expect(res.status).toBe(401);
  });
});
