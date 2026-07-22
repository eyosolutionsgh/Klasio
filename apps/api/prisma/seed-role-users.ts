/**
 * One signed-in account per ready-made role, for demonstrating what each job actually sees.
 *
 * The main seed creates four accounts — proprietor, head, bursar, class teacher — which is enough
 * to show the product working and not enough to show the *access model* working. What sells that
 * is signing in as the nurse and finding no fees, or as the accounts clerk and finding no way to
 * change what is owed. So: one account per preset, on the same school, sharing one password.
 *
 * Idempotent. Re-running updates the existing accounts rather than duplicating them, so it is
 * also the way to reset the demo after somebody has been clicking around in it.
 *
 * ## Running it against a remote database
 *
 *   TARGET_DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' \
 *   DEMO_PASSWORD='…' \
 *   pnpm --filter @eyo/api db:seed:roles
 *
 * Both are **required**, and the database URL is deliberately not `DATABASE_URL`.
 *
 * Prisma auto-loads `apps/api/.env`, and `dotenv` never overrides a variable that is already set —
 * so a seed run against a remote database quietly takes any value you did not pass from the local
 * dev file. That is not hypothetical: it is how a public test TOTP secret reached the deployed
 * vendor portal on 21 Jul 2026. A distinct variable name means a forgotten one fails loudly here
 * instead of silently writing dev fixtures into a live instance, and the client below is
 * constructed with an explicit datasource so `DATABASE_URL` cannot stand in for it.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PRESETS } from '../src/common/permissions';

const url = process.env.TARGET_DATABASE_URL;
const password = process.env.DEMO_PASSWORD;

if (!url) {
  console.error(
    'TARGET_DATABASE_URL is required.\n' +
      'Named apart from DATABASE_URL on purpose — see the note at the top of this file.',
  );
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error(
    'DEMO_PASSWORD is required (8 characters or more).\n' +
      'Passed explicitly rather than generated, so you know what it is before it is written, and\n' +
      'so nothing is quietly inherited from a local .env.',
  );
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });

/**
 * Who each account is, in the order a visitor should try them.
 *
 * Names are ordinary Ghanaian staff-room names rather than "Test Bursar": a demo that reads like
 * a real school is the point, and screenshots of it end up in front of head teachers. Addresses
 * are mailinator so anyone evaluating can read the mail the system sends them.
 */
const PEOPLE: { presetKey: string; name: string; email: string }[] = [
  { presetKey: 'HEAD', name: 'Mrs. Dora Ampofo', email: 'klasio-head@mailinator.com' },
  { presetKey: 'ASSISTANT_HEAD', name: 'Mr. Yaw Boakye', email: 'klasio-asst-head@mailinator.com' },
  { presetKey: 'HEAD_OF_DEPARTMENT', name: 'Mr. Kwesi Danso', email: 'klasio-hod@mailinator.com' },
  { presetKey: 'CLASS_TEACHER', name: 'Ms. Efua Sarpong', email: 'klasio-teacher@mailinator.com' },
  {
    presetKey: 'SUBJECT_TEACHER',
    name: 'Mr. Kofi Mensah',
    email: 'klasio-subject-teacher@mailinator.com',
  },
  { presetKey: 'EXAMS_OFFICER', name: 'Mr. Nii Armah', email: 'klasio-exams@mailinator.com' },
  { presetKey: 'BURSAR', name: 'Mr. Ebo Quaye', email: 'klasio-bursar@mailinator.com' },
  { presetKey: 'ACCOUNTS_CLERK', name: 'Ms. Adjoa Nyarko', email: 'klasio-clerk@mailinator.com' },
  { presetKey: 'REGISTRAR', name: 'Mr. Selorm Agbo', email: 'klasio-registrar@mailinator.com' },
  { presetKey: 'FRONT_DESK', name: 'Ms. Akua Bediako', email: 'klasio-frontdesk@mailinator.com' },
  { presetKey: 'SCHOOL_NURSE', name: 'Nurse Comfort Owusu', email: 'klasio-nurse@mailinator.com' },
  { presetKey: 'LIBRARIAN', name: 'Mr. Fiifi Tetteh', email: 'klasio-librarian@mailinator.com' },
  { presetKey: 'IT_ADMIN', name: 'Ms. Ama Asare', email: 'klasio-sysadmin@mailinator.com' },
];

async function main() {
  // Say where this is going before writing anything. Host only — the credentials in the string
  // are not something to print, and the host is what tells you whether you aimed at the right one.
  const host = url!.replace(/^[^@]*@/, '').replace(/\?.*$/, '');
  console.log(`Target: ${host}`);

  /**
   * The oldest school, which is the school: one school per box, and the licence check identifies
   * the box the same way. On a demo instance carrying a second school, that tie-break matters.
   */
  const school = await db.school.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!school) {
    console.error('No school on this database. Run the main seed, or /setup, first.');
    process.exit(1);
  }
  console.log(`School: ${school.name} (${school.slug})\n`);

  const roles = await db.staffRole.findMany({ where: { schoolId: school.id } });
  const byKey = new Map(roles.filter((r) => r.presetKey).map((r) => [r.presetKey!, r]));

  // A school that deleted a preset — or was created before one existed — should still get an
  // account for it, or the demo silently skips whichever role is most interesting.
  for (const preset of ROLE_PRESETS) {
    if (byKey.has(preset.key)) continue;
    const created = await db.staffRole.create({
      data: {
        schoolId: school.id,
        name: preset.name,
        description: preset.description,
        permissions: [...preset.permissions],
        presetKey: preset.key,
      },
    });
    byKey.set(preset.key, created);
    console.log(`  + restored the ${preset.name} role`);
  }

  const passwordHash = await bcrypt.hash(password!, 10);
  const rows: { role: string; name: string; email: string }[] = [];

  for (const person of PEOPLE) {
    const role = byKey.get(person.presetKey);
    if (!role) continue;
    const email = person.email.toLowerCase();

    /**
     * `role: STAFF` for every one of them. The account type is no longer a job title — the staff
     * role is — and the proprietor is deliberately untouched here: the main seed creates it, and
     * an account that can never be narrowed is not one to rewrite from a convenience script.
     */
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      await db.user.update({
        where: { email },
        data: {
          name: person.name,
          staffRoleId: role.id,
          active: true,
          passwordHash,
          // Every session on the old password ends, so a re-run really is a reset.
          tokenVersion: { increment: 1 },
          ...(existing.role === 'OWNER' ? {} : { role: 'STAFF' as Role }),
        },
      });
    } else {
      await db.user.create({
        data: {
          schoolId: school.id,
          name: person.name,
          email,
          role: 'STAFF',
          staffRoleId: role.id,
          passwordHash,
        },
      });
    }
    rows.push({ role: role.name, name: person.name, email });
  }

  const width = Math.max(...rows.map((r) => r.role.length));
  console.log(`${rows.length} accounts, all on the same password:\n`);
  for (const r of rows) console.log(`  ${r.role.padEnd(width)}  ${r.email}`);
  console.log(
    '\nEvery one of them signs in at the same door. What differs is what they find there.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
