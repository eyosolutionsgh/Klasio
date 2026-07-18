/**
 * The negative half of the suite: proof that the fixes above did not buy their green tests by
 * quietly weakening tenancy.
 *
 * Every test in the other files asserts that a write SUCCEEDS. Taken alone they would all pass
 * just as well if row-level security had been switched off — which is the cheapest possible way
 * to "fix" an RLS bug and the one most likely to go unnoticed. These tests fail if it were.
 *
 * They talk to Postgres directly as the runtime role rather than through the API, because the
 * property under test belongs to the database: it must hold for a query that forgot its
 * `where: { schoolId }` clause, not merely for one that remembered.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl } from './setup/env';
import { Api, call, ownerDb, otherSchool, seededSchool, startApi } from './setup/harness';

describe('tenant isolation', () => {
  let app: PrismaClient;
  let db: PrismaClient;
  let schoolId: string;
  let otherId: string;

  beforeAll(async () => {
    db = ownerDb();
    // The same non-owner role the API serves requests on, so the same policies apply.
    app = new PrismaClient({ datasources: { db: { url: appUrl() } } });
    schoolId = (await seededSchool(db)).school.id;
    otherId = (await otherSchool(db)).school.id;
  });

  afterAll(async () => {
    await app.$disconnect();
    await db.$disconnect();
  });

  it('the runtime role is not the table owner and cannot bypass policies', async () => {
    // If this ever fails, every other assertion in this file is meaningless.
    const [me] = await app.$queryRawUnsafe<Array<{ rolbypassrls: boolean; rolsuper: boolean }>>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    expect(me.rolbypassrls).toBe(false);
    expect(me.rolsuper).toBe(false);

    const [owns] = await app.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    expect(Number(owns.n)).toBe(0);
  });

  it('an unscoped read returns nothing when no tenant is set', async () => {
    // The owner can see the whole roll…
    expect(await db.student.count()).toBeGreaterThan(0);

    // …the runtime role, with no `app.school_id`, sees none of it. Note there is no `where`
    // clause here at all: this is the forgotten-filter case, and the database refuses it.
    const [row] = await app.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "Student"`,
    );
    expect(Number(row.n)).toBe(0);
  });

  it('a read sees exactly one school at a time, chosen only by the tenant setting', async () => {
    const seededCount = await db.student.count({ where: { schoolId } });
    const otherCount = await db.student.count({ where: { schoolId: otherId } });

    const visible = async (tenant: string) => {
      // set_config(..., true) is transaction-local, exactly as the request path uses it.
      const [r] = await app.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SELECT set_config('app.school_id', $1, true)`, tenant);
        return tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "Student"`);
      });
      return Number(r.n);
    };

    expect(await visible(schoolId)).toBe(seededCount);
    expect(await visible(otherId)).toBe(otherCount);
    expect(seededCount).not.toBe(otherCount); // otherwise the assertion proves nothing
  });

  it('a cross-tenant write is refused', async () => {
    const victim = await db.student.findFirstOrThrow({ where: { schoolId: otherId } });
    const originalName = victim.firstName;

    const affected = await app.$transaction(async (tx) => {
      // Scoped to the DEMO school, then reaching for the OTHER school's child by primary key.
      await tx.$queryRawUnsafe(`SELECT set_config('app.school_id', $1, true)`, schoolId);
      return tx.$executeRawUnsafe(
        `UPDATE "Student" SET "firstName" = 'Hacked' WHERE id = $1`,
        victim.id,
      );
    });
    expect(affected).toBe(0);

    const after = await db.student.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.firstName).toBe(originalName);
  });

  it("an INSERT carrying another school's id is refused outright", async () => {
    const id = 'integration-cross-tenant-guardian';
    // The seed only wipes the demo school, so this sentinel would survive a run in which the
    // insert wrongly succeeded — and the next run would then fail for the wrong reason.
    await db.guardian.deleteMany({ where: { id } });

    await expect(
      app.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SELECT set_config('app.school_id', $1, true)`, schoolId);
        // A row that claims to belong to the other school, written while scoped to this one.
        // The policy's WITH CHECK clause rejects it: RLS constrains what may be written, not
        // just what may be read.
        return tx.guardian.create({
          data: {
            id,
            schoolId: otherId,
            firstName: 'Mallory',
            lastName: 'Cross',
            phone: '+233240000000',
          },
        });
      }),
    ).rejects.toThrow(/row-level security/i);

    expect(await db.guardian.count({ where: { id } })).toBe(0);
  });
});

describe('tenant isolation over HTTP', () => {
  let api: Api;
  let db: PrismaClient;

  beforeAll(async () => {
    db = ownerDb();
    api = await startApi();
  });

  afterAll(async () => {
    await api.close();
    await db.$disconnect();
  });

  it("one school's principal cannot read another school's student", async () => {
    const { token } = await seededSchool(db);
    const { student } = await otherSchool(db);

    const res = await call(api.baseUrl, 'GET', `/students/${student.id}`, { token });
    // Not found rather than forbidden: the row is invisible, so the API cannot even confirm
    // it exists — which is the point.
    expect(res.status).toBe(404);
  });

  it("one school's principal cannot write to another school's student", async () => {
    const { token } = await seededSchool(db);
    const { student } = await otherSchool(db);
    const before = await db.student.findUniqueOrThrow({ where: { id: student.id } });

    const res = await call(api.baseUrl, 'PATCH', `/students/${student.id}`, {
      token,
      body: { firstName: 'Hacked' },
    });
    expect(res.status).toBe(404);

    const after = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(after.firstName).toBe(before.firstName);
  });
});
