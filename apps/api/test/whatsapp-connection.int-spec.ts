/**
 * A school connecting its own WhatsApp number.
 *
 * Until this existed the credentials came from the box's environment, so connecting WhatsApp meant
 * editing a file on the server — and on a product where every school runs its own box, a school
 * that had not done that saw a permanently empty screen.
 *
 * The assertions are the three properties that make it safe to hold somebody's messaging token:
 * it is encrypted at rest, it is never readable back through the API, and it belongs to one school
 * only — which is a row-level-security question, hence a live database rather than a unit test.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, otherSchool, ownerDb, seededSchool, startApi } from './setup/harness';

const TOKEN = 'EAAG-pretend-meta-token-long-enough-to-pass';

describe('connecting a WhatsApp number', () => {
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
    await db.whatsAppAccount.deleteMany({ where: { schoolId } });
  });

  afterAll(async () => {
    await db.whatsAppAccount.deleteMany({ where: { schoolId } });
    await api.close();
    await db.$disconnect();
  });

  it('starts unconnected, and says so without pretending', async () => {
    const res = await call<{ connected: boolean }>(api.baseUrl, 'GET', '/whatsapp/config', {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it('stores the token encrypted and never hands it back', async () => {
    const saved = await call<Record<string, unknown>>(api.baseUrl, 'POST', '/whatsapp/config', {
      token,
      body: { phoneNumberId: '123456789012345', token: TOKEN, displayNumber: '+233 24 123 4567' },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);

    // Not in the answer, under any key: a credential an API will read back out is one screenshot
    // away from being somebody else's.
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    expect(saved.body.connected).toBe(true);
    expect(saved.body.displayNumber).toBe('+233 24 123 4567');

    const row = await db.whatsAppAccount.findFirstOrThrow({ where: { schoolId } });
    expect(row.tokenEnc).not.toContain(TOKEN);
    expect(row.tokenEnc.startsWith('v1:'), 'stored through encryptSecret').toBe(true);

    const read = await call<Record<string, unknown>>(api.baseUrl, 'GET', '/whatsapp/config', {
      token,
    });
    expect(JSON.stringify(read.body)).not.toContain(TOKEN);
  });

  it('does not leak into the audit log', async () => {
    // The audit trail is read by people; it is not a place to keep a credential.
    const row = await db.auditLog.findFirst({
      where: { schoolId, action: 'whatsapp.connect' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toBeTruthy();
    expect(JSON.stringify(row!.detail)).not.toContain(TOKEN);
  });

  it('belongs to one school only', async () => {
    // The negative half, and the reason this is an integration test: a missing RLS policy fails
    // open and silently, so it has to be asked of a real database as another tenant.
    const other = await otherSchool(db);
    const res = await call<{ connected: boolean }>(api.baseUrl, 'GET', '/whatsapp/config', {
      token: other.token,
    });
    expect(res.status).toBe(200);
    expect(res.body.connected, "another school's connection is not this school's").toBe(false);
  });

  it('disconnects without destroying the conversation history', async () => {
    const before = await db.whatsAppConversation.count({ where: { schoolId } });
    const res = await call<{ connected: boolean }>(api.baseUrl, 'DELETE', '/whatsapp/config', {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(await db.whatsAppAccount.count({ where: { schoolId } })).toBe(0);
    // What the school was told and what it said back outlives the connection.
    expect(await db.whatsAppConversation.count({ where: { schoolId } })).toBe(before);
  });
});
