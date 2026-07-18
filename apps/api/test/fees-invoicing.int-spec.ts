/**
 * Invoice generation — the largest of the six write paths that a nested `$transaction` broke.
 *
 * `this.db.$transaction([...])` inside a request passed through the tenant proxy to the BASE
 * client, so it ran on a connection with no `app.school_id` and every write in it was refused:
 * "new row violates row-level security policy". A whole term's billing produced nothing.
 *
 * The run writes an Invoice, an INVOICE ledger entry and one DISCOUNT entry per applied
 * concession, all as sequential awaits inside the request's own tenant transaction. This test
 * asserts all three land, because the failure mode was partial: the reads that choose students
 * and fee items succeed regardless, so the endpoint looked like it was working.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('invoice generation', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  /** The seed bills Term 3 only, so Terms 1 and 2 are clean ground to invoice. */
  let termId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;

    const term = await db.term.findFirstOrThrow({
      where: { academicYear: { schoolId }, isCurrent: false },
      orderBy: { startDate: 'asc' },
    });
    termId = term.id;

    // Start from a known state: this file is the only thing that bills this term.
    await db.ledgerEntry.deleteMany({ where: { schoolId, termId } });
    await db.invoice.deleteMany({ where: { schoolId, termId } });
    await db.feeItem.deleteMany({ where: { schoolId, termId } });
    await db.concessionAward.deleteMany({ where: { schoolId } });
    await db.concessionRule.deleteMany({ where: { schoolId } });
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it('writes invoices, INVOICE ledger entries and concession DISCOUNT entries', async () => {
    // ── Arrange: one compulsory fee item, and a half-price scholarship for one child ──
    const tuition = await call<{ id: string }>(api.baseUrl, 'POST', '/fees/items', {
      token,
      body: { termId, name: 'Tuition', amount: 1000, optional: false },
    });
    expect(tuition.status, JSON.stringify(tuition.body)).toBe(201);

    const rule = await call<{ id: string }>(api.baseUrl, 'POST', '/fees/concessions/rules', {
      token,
      body: { name: 'Half Scholarship', kind: 'SCHOLARSHIP', basis: 'PERCENT', value: 50 },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const ruleId = rule.body.id;

    const scholar = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
      orderBy: { admissionNo: 'asc' },
    });
    const award = await call(api.baseUrl, 'POST', '/fees/concessions/awards', {
      token,
      body: { ruleId, studentId: scholar.id, reason: 'top of the class' },
    });
    expect(award.status, JSON.stringify(award.body)).toBe(201);

    const activeStudents = await db.student.count({ where: { schoolId, status: 'ACTIVE' } });

    // ── Act ──
    const res = await call<{ created: number; skipped: number }>(
      api.baseUrl,
      'POST',
      '/fees/invoices/generate',
      { token, body: { termId } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created).toBe(activeStudents);

    // ── Assert: the rows are really there, read as the owner ──
    const invoices = await db.invoice.findMany({ where: { schoolId, termId } });
    expect(invoices).toHaveLength(activeStudents);
    expect(invoices.every((i) => Number(i.total) === 1000)).toBe(true);

    const charges = await db.ledgerEntry.findMany({ where: { schoolId, termId, type: 'INVOICE' } });
    expect(charges).toHaveLength(activeStudents);
    expect(charges.every((c) => Number(c.amount) === 1000)).toBe(true);

    // Exactly one DISCOUNT, for the one awarded child — a concession is a rule applied at
    // invoicing, not a balance of its own.
    const discounts = await db.ledgerEntry.findMany({
      where: { schoolId, termId, type: 'DISCOUNT' },
    });
    expect(discounts).toHaveLength(1);
    expect(discounts[0].studentId).toBe(scholar.id);
    expect(Number(discounts[0].amount)).toBe(500);
    expect(discounts[0].note).toBe('Half Scholarship');

    // The reference keys the discount to both the invoice and the rule, which is what stops a
    // re-run applying the same concession twice.
    const scholarInvoice = invoices.find((i) => i.studentId === scholar.id)!;
    expect(discounts[0].reference).toBe(`${scholarInvoice.number}-DSC-${ruleId.slice(-6)}`);
  });

  it('is idempotent: a second run bills nobody twice', async () => {
    const before = await db.invoice.count({ where: { schoolId, termId } });

    const res = await call<{ created: number; skipped: number }>(
      api.baseUrl,
      'POST',
      '/fees/invoices/generate',
      { token, body: { termId } },
    );
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(0);

    expect(await db.invoice.count({ where: { schoolId, termId } })).toBe(before);
    expect(await db.ledgerEntry.count({ where: { schoolId, termId, type: 'DISCOUNT' } })).toBe(1);
  });

  it('records a manually granted concession as a DISCOUNT entry', async () => {
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
      orderBy: { admissionNo: 'desc' },
    });

    const res = await call(api.baseUrl, 'POST', '/fees/concessions', {
      token,
      body: {
        studentId: student.id,
        amount: 120,
        type: 'DISCOUNT',
        reason: 'hardship, agreed with the head',
        termId,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const entry = await db.ledgerEntry.findFirstOrThrow({
      where: {
        schoolId,
        termId,
        studentId: student.id,
        type: 'DISCOUNT',
        note: { contains: 'hardship' },
      },
    });
    expect(Number(entry.amount)).toBe(120);
  });
});
