/**
 * The WhatsApp assistant, end to end through the signed webhook: a recognised parent asking the
 * set-list questions gets answers from live records; an unknown number gets no child's data;
 * asking for a person silences the bot; and a pickup-change message lands in the office's
 * dismissal inbox. The bot replies are OUTBOUND rows with no sender — that is how they are told
 * apart from staff replies.
 */
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, ownerDb, seededSchool, startApi } from './setup/harness';

const SECRET = 'test-whatsapp-secret';

async function inbound(api: Api, schoolId: string, from: string, text: string) {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from,
                  id: `wamid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  const signature =
    'sha256=' + createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');
  return fetch(`${api.baseUrl}/whatsapp/webhook/${schoolId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  });
}

describe('whatsapp assistant', () => {
  let api: Api;
  let db: PrismaClient;
  let schoolId: string;
  let guardianPhone: string;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    schoolId = seeded.school.id;
    const guardian = await db.guardian.findFirstOrThrow({
      where: { schoolId, students: { some: { student: { status: 'ACTIVE' } } } },
    });
    guardianPhone = guardian.phone;
  });

  afterAll(async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    await api.close();
    await db.$disconnect();
  });

  const lastBotReply = async (phone: string) => {
    const conv = await db.whatsAppConversation.findFirstOrThrow({
      where: { schoolId, phone: { contains: phone.slice(-9) } },
    });
    return db.whatsAppMessage.findFirstOrThrow({
      where: { conversationId: conv.id, direction: 'OUTBOUND', sentById: null },
      orderBy: { createdAt: 'desc' },
    });
  };

  it('answers a balance question from the live ledger', async () => {
    const res = await inbound(api, schoolId, guardianPhone, 'What do I owe?');
    expect(res.status).toBe(201);
    const reply = await lastBotReply(guardianPhone);
    // Either the figure or the which-child prompt — both are correct behaviour; drive to the answer.
    if (reply.body.startsWith('Which child')) {
      await inbound(api, schoolId, guardianPhone, '1');
    }
    const answer = await lastBotReply(guardianPhone);
    expect(answer.body).toMatch(/balance is|fully paid/);
  });

  it('never attaches a child to an unknown number', async () => {
    const stranger = '+233209999888';
    await inbound(api, schoolId, stranger, 'What do I owe?');
    const reply = await lastBotReply(stranger);
    expect(reply.body).toContain("isn't linked to a family");
    const conv = await db.whatsAppConversation.findFirstOrThrow({
      where: { schoolId, phone: { contains: stranger.slice(-9) } },
    });
    expect(conv.guardianId).toBeNull();
  });

  it('a pickup change lands in the dismissal inbox for the office to decide', async () => {
    const before = await db.dismissalRequest.count({ where: { schoolId } });
    await inbound(api, schoolId, guardianPhone, 'My sister is collecting today');
    const reply = await lastBotReply(guardianPhone);
    if (reply.body.startsWith('Which child')) {
      await inbound(api, schoolId, guardianPhone, '1');
    }
    const after = await db.dismissalRequest.count({ where: { schoolId } });
    expect(after).toBe(before + 1);
    const answer = await lastBotReply(guardianPhone);
    expect(answer.body).toContain('office');
  });

  it('a person asking for a person silences the bot for the window', async () => {
    await inbound(api, schoolId, guardianPhone, 'I want to speak to someone');
    const handoff = await lastBotReply(guardianPhone);
    expect(handoff.body).toContain('office');

    // The next question gets NO bot answer — staff have the thread now.
    await inbound(api, schoolId, guardianPhone, 'What do I owe?');
    const latest = await lastBotReply(guardianPhone);
    expect(latest.id).toBe(handoff.id);
  });
});
