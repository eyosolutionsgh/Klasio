/**
 * §21 without a model: the deterministic layer must answer on a box with no AI key at all.
 * Default-risk and at-risk flags come from the ledger and registers with reasons attached, and
 * plain-English questions fall back to keyword routing over the same safe report templates.
 * The drafting features refuse plainly instead of degrading silently.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('ai (deterministic layer)', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_URL;
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('reports itself unconfigured', async () => {
    const res = await call<{ configured: boolean }>(api.baseUrl, 'GET', '/ai/status', { token });
    expect(res.body.configured).toBe(false);
  });

  it('flags families likely to fall behind, with reasons, from the seeded ledger', async () => {
    const res = await call<{ name: string; reasons: string[]; level: string }[]>(
      api.baseUrl,
      'GET',
      '/ai/default-risk',
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The seed leaves balances owing, so something is flagged — and every flag says why.
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((f) => f.reasons.length > 0)).toBe(true);
  });

  it('answers a plain-English fees question by keyword fallback', async () => {
    const res = await call<{ answer: string; rows: { label: string; value: number }[] }>(
      api.baseUrl,
      'POST',
      '/ai/ask',
      { token, body: { question: 'Which classes are furthest behind on fees this term?' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.answer).toContain('behind');
  });

  it('refuses to draft a remark rather than pretending', async () => {
    const student = await db.student.findFirstOrThrow({
      where: { status: 'ACTIVE' },
    });
    const term = await db.term.findFirstOrThrow({ where: { isCurrent: true } });
    const res = await call<{ message: string }>(api.baseUrl, 'POST', '/ai/remarks/draft', {
      token,
      body: { studentId: student.id, termId: term.id },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('No AI provider');
  });

  it('children at risk come with reasons', async () => {
    const res = await call<{ reasons: string[] }[]>(api.baseUrl, 'GET', '/ai/at-risk', { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.every((f) => f.reasons.length > 0)).toBe(true);
  });
});
