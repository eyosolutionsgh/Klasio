/**
 * Guardian add / edit / remove — three of the six call sites a nested `$transaction` broke.
 *
 * All three are multi-statement writes: promoting a new primary contact demotes the previous
 * one, and removing a primary promotes a successor. That is exactly the shape that reached for
 * `$transaction([...])`, escaped the request's tenant transaction, and was refused by RLS.
 *
 * The interesting assertion in each case is the SECOND statement, not the first — a partially
 * applied write leaves two primary guardians on one child, which is how the school ends up
 * texting the wrong parent.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('guardian write paths', () => {
  let api: Api;
  let db: PrismaClient;
  let token: string;
  let schoolId: string;
  let studentId: string;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
    const seeded = await seededSchool(db);
    token = seeded.token;
    schoolId = seeded.school.id;
    const student = await db.student.findFirstOrThrow({
      where: { schoolId, status: 'ACTIVE' },
      orderBy: { admissionNo: 'asc' },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  const links = () =>
    db.studentGuardian.findMany({ where: { studentId }, include: { guardian: true } });

  it('adds a guardian, and promoting them demotes the previous primary', async () => {
    const before = await links();
    expect(before.length).toBeGreaterThan(0); // the seed gives every child a parent

    const res = await call<{ id: string; reused: boolean }>(
      api.baseUrl,
      'POST',
      `/students/${studentId}/guardians`,
      {
        token,
        body: {
          firstName: 'Yaa',
          lastName: 'Boateng',
          phone: '0244123456',
          relationship: 'Aunt',
          isPrimary: true,
          canPickup: true,
        },
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = await links();
    expect(after).toHaveLength(before.length + 1);

    // Both halves of the write: the new link exists AND it is the only primary.
    const added = after.find((l) => l.guardianId === res.body.id);
    expect(added).toBeDefined();
    expect(added!.isPrimary).toBe(true);
    expect(added!.relationship).toBe('Aunt');
    expect(added!.canPickup).toBe(true);
    expect(after.filter((l) => l.isPrimary)).toHaveLength(1);
  });

  it('edits a guardian across both the guardian row and the link row', async () => {
    const link = (await links()).find((l) => l.guardian.firstName === 'Yaa')!;

    const res = await call(
      api.baseUrl,
      'PATCH',
      `/students/${studentId}/guardians/${link.guardianId}`,
      {
        token,
        body: { firstName: 'Yaa Asantewaa', relationship: 'Grandmother', canPickup: false },
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const updated = await db.studentGuardian.findUniqueOrThrow({
      where: { studentId_guardianId: { studentId, guardianId: link.guardianId } },
      include: { guardian: true },
    });
    expect(updated.guardian.firstName).toBe('Yaa Asantewaa'); // Guardian table
    expect(updated.relationship).toBe('Grandmother'); // StudentGuardian table
    expect(updated.canPickup).toBe(false);
  });

  it('removes the primary guardian and promotes a successor', async () => {
    const before = await links();
    const primary = before.find((l) => l.isPrimary)!;
    expect(before.length).toBeGreaterThan(1); // there must be someone to promote

    const res = await call<{ ok: boolean; promoted: string | null }>(
      api.baseUrl,
      'DELETE',
      `/students/${studentId}/guardians/${primary.guardianId}`,
      { token },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.promoted).toBeTruthy();

    const after = await links();
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((l) => l.guardianId === primary.guardianId)).toBe(false);
    // A child is never left without a primary contact.
    expect(after.filter((l) => l.isPrimary)).toHaveLength(1);
    expect(after.find((l) => l.isPrimary)!.guardianId).toBe(res.body.promoted);
  });
});
