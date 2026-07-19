/**
 * Remove a school created by the registration end-to-end test.
 *
 * Registering is the one flow that cannot be re-run against its own leftovers: the owner's email
 * is unique across every school, so a second run would be refused by the product working exactly
 * as intended. This clears the previous run's school so the test stays repeatable.
 *
 * Deliberately narrow. It refuses any school that holds students, so it can never be pointed at a
 * seeded demo tenant or a real one — a freshly registered school has an owner and staff roles and
 * nothing else, and that is all this knows how to delete.
 *
 *   ts-node --transpile-only prisma/e2e-purge-registered-school.ts <owner-email>
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error('usage: e2e-purge-registered-school <owner-email>');

  // Invitations outlive the school they created (`schoolId` is SET NULL), so clearing them is
  // part of starting from nothing — otherwise a re-run accumulates a spent invitation per pass
  // and any test looking for "the row for this school" finds several.
  const invitations = await db.schoolInvitation.deleteMany({ where: { email } });

  const owner = await db.user.findUnique({ where: { email }, select: { schoolId: true } });
  if (!owner) {
    console.log(
      JSON.stringify({ purged: false, reason: 'no such account', invitations: invitations.count }),
    );
    return;
  }

  const sid = owner.schoolId;
  const students = await db.student.count({ where: { schoolId: sid } });
  if (students > 0) {
    throw new Error(`refusing to delete school ${sid}: it has ${students} students`);
  }

  // Explicit rather than leaning on cascades: this has to leave nothing behind, or the next
  // run inherits a subscription and stops testing what it says it tests.
  await db.subscriptionInvoice.deleteMany({ where: { schoolId: sid } });
  await db.subscription.deleteMany({ where: { schoolId: sid } });
  await db.auditLog.deleteMany({ where: { schoolId: sid } });
  await db.user.deleteMany({ where: { schoolId: sid } });
  await db.staffRole.deleteMany({ where: { schoolId: sid } });
  await db.school.delete({ where: { id: sid } });

  console.log(JSON.stringify({ purged: true, schoolId: sid, invitations: invitations.count }));
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
