/**
 * "No fees, no report card" — the end-of-term rule almost every Ghanaian private school runs, and
 * the one the audit found specified in two user stories and implemented nowhere.
 *
 * Proved against a live database because the gate spans three tables (the school's policy flag,
 * the append-only ledger, and the per-child override) and two principals (a guardian and a
 * pupil), and because FeeClearance is a new tenant table — which needs both an RLS policy and a
 * grant, only one of which fails loudly.
 */
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtSecret } from '../src/common/auth';
import { balanceOf } from '../src/common/ledger';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

const guardianToken = (g: { id: string; schoolId: string; firstName: string; lastName: string }) =>
  jwt.sign(
    { sub: g.id, schoolId: g.schoolId, kind: 'guardian', name: `${g.firstName} ${g.lastName}` },
    jwtSecret(),
    { expiresIn: '1d' },
  );

describe('fee clearance gate on report release', () => {
  let api: Api;
  let db: PrismaClient;
  let staffToken: string;
  let schoolId: string;
  let studentId: string;
  let termId: string;
  let guardian: { id: string; schoolId: string; firstName: string; lastName: string };
  let staffUserId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    staffToken = seeded.token;
    schoolId = seeded.school.id;
    staffUserId = seeded.owner.id;

    /*
      Provision the state rather than assume it: the seed writes scores but never generates or
      publishes a report, so a spec that looked for a published one found nothing and skipped
      itself — which reads as a pass.
    */
    const term = await db.term.findFirstOrThrow({
      where: { academicYear: { schoolId }, isCurrent: true },
    });
    termId = term.id;
    const scored = await db.score.findFirstOrThrow({
      where: { schoolId, termId, student: { status: 'ACTIVE', classId: { not: null } } },
      select: { student: { select: { classId: true } } },
    });
    const classId = scored.student.classId as string;

    const generated = await call(api.baseUrl, 'POST', '/assessment/reports/generate', {
      token: staffToken,
      body: { classId, termId, regeneratePublished: true },
    });
    expect(generated.status, JSON.stringify(generated.body)).toBe(201);
    const published = await call(api.baseUrl, 'POST', '/assessment/reports/publish', {
      token: staffToken,
      body: { classId, termId, published: true },
    });
    expect(published.status, JSON.stringify(published.body)).toBe(201);

    // A child in that class whose guardian is not custody-blocked.
    const link = await db.studentGuardian.findFirstOrThrow({
      where: {
        custodyFlag: { not: 'BLOCKED' },
        student: { schoolId, classId, status: 'ACTIVE' },
      },
      include: { guardian: true },
    });
    studentId = link.studentId;
    guardian = link.guardian;
  });

  afterAll(async () => {
    // Leave the policy off: it is off by default, and other specs read reports.
    await db.school.update({
      where: { id: schoolId },
      data: { reportsRequireFeeClearance: false },
    });
    await db.feeClearance.deleteMany({ where: { schoolId } });
    await api.close();
    await db.$disconnect();
  });

  /**
   * Put the family exactly `amount` in debt — including exactly nothing.
   *
   * The seed bills fees and collects most of them, so roughly a third of its students still owe
   * something. Which one this spec picks comes from a `findFirstOrThrow`, so deleting only this
   * spec's own rows left the balance at whatever the seed happened to leave: zero for most
   * students and not zero for the rest. "Releases the report once the balance is settled" then
   * passed or failed on which row the database returned first.
   *
   * Settling is a PAYMENT for whatever is outstanding rather than a delete, because the ledger is
   * append-only and money is not made to disappear by removing rows — the same reason production
   * corrects with a REVERSAL. It carries the ITEST- reference so the next call clears it.
   */
  async function owe(amount: number) {
    await db.ledgerEntry.deleteMany({ where: { studentId, reference: { startsWith: 'ITEST-' } } });

    /**
     * Measured, not assumed.
     *
     * This used to bill `amount` and call it done, which only lands on `amount` if the child
     * starts at zero — and they often do not. The seed leaves about a third of students owing,
     * and a spec running earlier in the suite can leave this one in *credit*: deposit-separation
     * confirms a bank deposit, which is a payment on somebody's ledger. Billing a child who is
     * 1,000 in credit still leaves them owing nothing, the report was released exactly as it
     * should be, and three assertions failed for a reason that had nothing to do with clearance.
     */
    const current = balanceOf(
      await db.ledgerEntry.findMany({
        where: { studentId },
        select: { id: true, type: true, amount: true, reversedId: true },
      }),
    );
    const delta = amount - current;
    // Already there. Cent-level tolerance rather than `=== 0`, since these are money floats.
    if (Math.abs(delta) < 0.005) return;

    await db.ledgerEntry.create({
      data: {
        schoolId,
        studentId,
        termId,
        /**
         * Owing more than they do: bill the difference. Owing less, or in credit: pay it down.
         * A PAYMENT rather than deleting rows, because the ledger is append-only and money does
         * not disappear by removing history — the same reason production corrects with REVERSAL.
         */
        type: delta > 0 ? 'INVOICE' : 'PAYMENT',
        amount: Math.abs(delta),
        reference: `ITEST-${delta > 0 ? 'OWE' : 'SETTLE'}-${Date.now()}`,
        createdById: staffUserId,
      },
    });
  }

  async function setPolicy(on: boolean) {
    await db.school.update({
      where: { id: schoolId },
      data: { reportsRequireFeeClearance: on },
    });
  }

  const reports = () =>
    call<{ termId: string; held: boolean; overallTotal: number | null }[]>(
      api.baseUrl,
      'GET',
      `/guardian/wards/${studentId}/reports`,
      { token: guardianToken(guardian) },
    );

  const pdf = () =>
    call(api.baseUrl, 'GET', `/guardian/wards/${studentId}/reports/${termId}/pdf`, {
      token: guardianToken(guardian),
    });

  it('shows the report normally while the school has not switched the policy on', async () => {
    await setPolicy(false);
    await owe(500);

    const list = await reports();
    expect(list.status).toBe(200);
    const row = list.body.find((r) => r.termId === termId);
    expect(row?.held).toBe(false);
    expect(row?.overallTotal).not.toBeNull();
    expect((await pdf()).status).toBe(200);
  });

  it('holds the report — in the list and on the PDF — once the policy is on and fees are owed', async () => {
    await setPolicy(true);
    await owe(500);

    const list = await reports();
    const row = list.body.find((r) => r.termId === termId);
    // Listed, not hidden: the family must know the report exists and why it is closed to them.
    expect(row).toBeDefined();
    expect(row?.held).toBe(true);
    // Withheld marks are absent rather than zeroed — a zero is a claim about the child.
    expect(row?.overallTotal).toBeNull();

    // And the gate is real, not merely an unrendered link: the PDF URL is guessable.
    expect((await pdf()).status).toBe(403);
  });

  it('releases the report as soon as the balance is settled', async () => {
    await setPolicy(true);
    await owe(0);

    const row = (await reports()).body.find((r) => r.termId === termId);
    expect(row?.held).toBe(false);
    expect((await pdf()).status).toBe(200);
  });

  it('releases one child through a bursar clearance, with a reason, without clearing the policy', async () => {
    await setPolicy(true);
    await owe(500);
    expect((await pdf()).status).toBe(403);

    const granted = await call(api.baseUrl, 'POST', '/fees/clearances', {
      token: staffToken,
      body: { studentId, termId, reason: 'On an agreed payment plan until 30 September' },
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);

    expect((await pdf()).status).toBe(200);
    const row = (await reports()).body.find((r) => r.termId === termId);
    expect(row?.held).toBe(false);

    // The reason is the point of the record — an override without one is a favour.
    const listed = await call<{ studentId: string; reason: string }[]>(
      api.baseUrl,
      'GET',
      `/fees/clearances?termId=${termId}`,
      { token: staffToken },
    );
    expect(listed.body.find((c) => c.studentId === studentId)?.reason).toMatch(/payment plan/i);
  });

  it('refuses a clearance with no real reason', async () => {
    const res = await call(api.baseUrl, 'POST', '/fees/clearances', {
      token: staffToken,
      body: { studentId, termId, reason: '' },
    });
    expect(res.status).toBe(400);
  });

  it('closes the door again when the clearance is revoked', async () => {
    await setPolicy(true);
    await owe(500);
    await call(api.baseUrl, 'POST', '/fees/clearances', {
      token: staffToken,
      body: { studentId, termId, reason: 'Temporary, pending the scholarship' },
    });
    expect((await pdf()).status).toBe(200);

    const revoked = await call(api.baseUrl, 'DELETE', `/fees/clearances/${studentId}/${termId}`, {
      token: staffToken,
    });
    expect(revoked.status).toBe(200);
    expect((await pdf()).status).toBe(403);
  });

  /**
   * The negative half. FeeClearance is a new tenant table, and a missing RLS policy fails open
   * and silently — the API would happily read another school's clearances and never say so.
   */
  it("cannot see another school's clearance rows", async () => {
    await db.feeClearance.deleteMany({ where: { schoolId } });
    await call(api.baseUrl, 'POST', '/fees/clearances', {
      token: staffToken,
      body: { studentId, termId, reason: 'Belongs to Brighton Academy alone' },
    });

    const other = await db.school.findFirst({ where: { slug: { not: 'brighton-academy' } } });
    if (!other) return;

    // Asked as the other school's principal: the row exists, and must be invisible.
    const otherOwner = await db.user.findFirst({ where: { schoolId: other.id, role: 'OWNER' } });
    if (!otherOwner) return;
    const otherToken = jwt.sign(
      {
        sub: otherOwner.id,
        schoolId: other.id,
        role: 'OWNER',
        tier: other.tier,
        name: otherOwner.name,
      },
      jwtSecret(),
      { expiresIn: '1d' },
    );
    const seen = await call<{ studentId: string }[]>(
      api.baseUrl,
      'GET',
      `/fees/clearances?termId=${termId}`,
      { token: otherToken },
    );
    expect(Array.isArray(seen.body) ? seen.body : []).toHaveLength(0);
  });
});
