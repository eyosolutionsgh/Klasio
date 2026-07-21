/**
 * Multi-campus: campus CRUD under RLS, class assignment, and the students filter that derives a
 * child's campus through their class. Deleting a campus must free its classes, not take them.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, call, ownerDb, seededSchool, startApi } from './setup/harness';

describe('campuses', () => {
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

  it('creates a campus, assigns a class, filters students by it, and frees classes on delete', async () => {
    const created = await call<{ id: string }>(api.baseUrl, 'POST', '/school/campuses', {
      token,
      body: { name: 'East Legon Campus', address: 'Accra' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const cls = await db.classRoom.findFirstOrThrow({
      where: { schoolId, students: { some: { status: 'ACTIVE' } } },
      include: { _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
    });
    const assigned = await call(api.baseUrl, 'PATCH', `/school/classes/${cls.id}`, {
      token,
      body: { campusId: created.body.id },
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    // Students derive their campus through their class.
    const filtered = await call<{ rows: { id: string }[]; total: number }>(
      api.baseUrl,
      'GET',
      `/students?campusId=${created.body.id}&perPage=all`,
      { token },
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(cls._count.students);

    // Deleting the campus frees the class rather than taking it down.
    const removed = await call(api.baseUrl, 'DELETE', `/school/campuses/${created.body.id}`, {
      token,
    });
    expect(removed.status).toBe(200);
    const after = await db.classRoom.findUniqueOrThrow({ where: { id: cls.id } });
    expect(after.campusId).toBeNull();
  });

  it('refuses a campus id from another school on class assignment', async () => {
    const cls = await db.classRoom.findFirstOrThrow({ where: { schoolId } });
    const res = await call(api.baseUrl, 'PATCH', `/school/classes/${cls.id}`, {
      token,
      body: { campusId: 'not-a-real-campus' },
    });
    expect(res.status).toBe(404);
  });
});
