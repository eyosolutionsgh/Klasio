/**
 * Provision the integration database once per run: create it, create the non-owner runtime role,
 * apply the migration chain, seed the demo school.
 *
 * The role has to exist *before* `migrate deploy`, because the row-level-security migration only
 * issues its GRANTs when it finds the role (it skips them otherwise so a bare CI database still
 * migrates clean). Create the role afterwards and it would end up with no privileges at all.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { signLicence, type LicencePayload } from '../../src/licence/licence';
import {
  INTEGRATION_DB,
  APP_ROLE,
  APP_ROLE_PASSWORD,
  OTHER_SCHOOL_SLUG,
  adminUrl,
  appUrl,
  ownerUrl,
} from './env';

const API_DIR = join(__dirname, '..', '..');
const PRISMA_BIN = join(API_DIR, 'node_modules', '.bin', 'prisma');
const DEV_KEY_PATH = join(API_DIR, '..', '..', 'ops', 'licence', 'dev-signing-key.pem');

/** The slug the seed gives its demo school. A licence naming any other school is refused. */
const SEED_SCHOOL_SLUG = 'brighton-academy';
const SEED_SCHOOL_NAME = 'Brighton Academy';

/**
 * Install a signed ADVANCED licence for the seeded school.
 *
 * Entitlements are asked of the licence, never of `School.tier` — so a box with no licence file
 * runs on BASIC no matter what the seed wrote to that column, and every `@RequireEntitlement`
 * route answers 403. That is correct behaviour, and it is invisible to a suite that never
 * installs one: the tenancy assertions would keep passing while the routes under them were
 * rejected before they ever reached a query.
 *
 * ADVANCED because this suite is testing tenant scoping, not feature gating — a route refused
 * for the wrong reason proves nothing about the right one.
 *
 * Signed with the committed development key, which the API refuses outright under
 * NODE_ENV=production, so this can never stand in for a real licence.
 */
async function installLicence(owner: PrismaClient) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const payload: LicencePayload = {
    v: 1,
    licenceId: 'lic_integration_suite',
    schoolName: SEED_SCHOOL_NAME,
    schoolSlug: SEED_SCHOOL_SLUG,
    tier: 'ADVANCED',
    studentCap: null,
    extraEntitlements: [],
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: 30,
  };

  // The dev key file carries an explanatory header above the PEM; take only the PEM.
  const keyFile = readFileSync(DEV_KEY_PATH, 'utf8');
  const raw = signLicence(payload, keyFile.slice(keyFile.indexOf('-----BEGIN PRIVATE KEY-----')));

  const row = {
    raw,
    licenceId: payload.licenceId,
    schoolSlug: payload.schoolSlug,
    tier: payload.tier,
    issuedAt: now,
    expiresAt,
  };
  // Written to the database rather than handed over as LICENCE=, because the row is what
  // `resolveRaw` consults first — so this is the path a real install actually takes.
  await owner.licence.upsert({ where: { id: 'singleton' }, create: row, update: row });
}

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, {
    cwd: API_DIR,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: ownerUrl() },
  });
}

/** Can we actually log in as the runtime role? The only question that really matters. */
async function appRoleUsable(): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: appUrl() } } });
  try {
    await probe.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

export default async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    // `IF NOT EXISTS` is not available for either statement, so ask first. Both are idempotent
    // across runs: the database is reused and re-seeded rather than dropped, which keeps a local
    // re-run fast.
    const [db] = await admin.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_database WHERE datname = $1`,
      INTEGRATION_DB,
    );
    if (Number(db.n) === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${INTEGRATION_DB}"`);
    }

    /**
     * Provision the role only if it cannot already be used.
     *
     * On CI the owner is the superuser of a throwaway container and simply creates it. On a
     * developer's machine the role is usually already there, created once by whoever has
     * CREATEROLE — and the owner may have no privilege to touch it. Probing first means the
     * common local case never needs a permission it does not have.
     */
    if (!(await appRoleUsable())) {
      const [role] = await admin.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM pg_roles WHERE rolname = $1`,
        APP_ROLE,
      );
      const sql =
        Number(role.n) === 0
          ? `CREATE ROLE "${APP_ROLE}" LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`
          : `ALTER ROLE "${APP_ROLE}" LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`;
      try {
        await admin.$executeRawUnsafe(sql);
      } catch (e) {
        throw new Error(
          `Cannot sign in as "${APP_ROLE}", and provisioning it failed.\n` +
            `Run this once as a role with CREATEROLE, then re-run the suite:\n  ${sql};`,
          { cause: e },
        );
      }
    }

    // The one property the whole suite depends on. A role with BYPASSRLS, or a superuser, sails
    // through every policy — the tenancy tests would still pass, for entirely the wrong reason.
    const [attrs] = await admin.$queryRawUnsafe<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1`, APP_ROLE);
    if (attrs?.rolbypassrls || attrs?.rolsuper) {
      throw new Error(
        `Role ${APP_ROLE} is SUPERUSER or has BYPASSRLS — row-level security would not apply to ` +
          `it and every tenancy assertion in this suite would pass for the wrong reason.`,
      );
    }
  } finally {
    await admin.$disconnect();
  }

  /**
   * Reset rather than deploy: every run starts from an empty schema.
   *
   * `migrate deploy` leaves the previous run's rows behind, and the seed only rebuilds the demo
   * school — so a feeding record, a WhatsApp thread or a ledger entry written by a spec survived
   * into the next run and changed what the next run counted. That produced failures that
   * alternated between runs on identical code, which is the most expensive kind: nobody can tell
   * a real break from the weather, so eventually nobody looks.
   *
   * `--skip-seed` because the seed is run below, deliberately, after the stale-school cleanup.
   * The `eyo_app` role survives a reset (roles are cluster-level, not schema-level), and the
   * migrations re-apply its grants as they run.
   */
  run(PRISMA_BIN, ['migrate', 'reset', '--force', '--skip-seed']);

  // Granting after migrate as well as during it: `migrate deploy` is a no-op on an already
  // migrated database, so on a re-run the migration's own GRANT block never executes.
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
  try {
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${APP_ROLE}"`);
    await owner.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${APP_ROLE}"`,
    );
    await owner.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${APP_ROLE}"`,
    );
  } finally {
    await owner.$disconnect();
  }

  /**
   * Drop the previous run's second school before re-seeding.
   *
   * The seed deletes and recreates the demo school, so it comes back with a *fresh* `createdAt`.
   * A second school left over from an earlier run therefore becomes the oldest row in the table
   * — and "the oldest school" is how a one-school-per-box build identifies itself, including
   * when it decides which school a licence names. Left in place, the licence installed below is
   * judged against "Other School", rejected as naming the wrong school, and the box silently
   * drops to BASIC: every entitlement-gated route then answers 403 on the second run of the
   * suite but not the first.
   *
   * Deleting it here rather than in the tenancy spec keeps the ordering right during the run
   * too: it gets recreated after the seed, so the demo school stays the oldest.
   */
  const cleaner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
  try {
    const stale = await cleaner.school.findFirst({ where: { slug: OTHER_SCHOOL_SLUG } });
    if (stale) {
      const schoolId = stale.id;
      await cleaner.guardian.deleteMany({ where: { schoolId } });
      await cleaner.student.deleteMany({ where: { schoolId } });
      await cleaner.user.deleteMany({ where: { schoolId } });
      await cleaner.school.delete({ where: { id: schoolId } });
    }
  } finally {
    await cleaner.$disconnect();
  }

  run(join(API_DIR, 'node_modules', '.bin', 'ts-node'), [
    '--transpile-only',
    join('prisma', 'seed.ts'),
  ]);

  // After the seed: the licence names a school by slug, so it is only meaningful once that
  // school exists.
  const licensee = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
  try {
    await installLicence(licensee);
  } finally {
    await licensee.$disconnect();
  }
}
