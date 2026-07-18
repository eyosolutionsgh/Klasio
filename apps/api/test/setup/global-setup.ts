/**
 * Provision the integration database once per run: create it, create the non-owner runtime role,
 * apply the migration chain, seed the demo school.
 *
 * The role has to exist *before* `migrate deploy`, because the row-level-security migration only
 * issues its GRANTs when it finds the role (it skips them otherwise so a bare CI database still
 * migrates clean). Create the role afterwards and it would end up with no privileges at all.
 */
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { INTEGRATION_DB, APP_ROLE, APP_ROLE_PASSWORD, adminUrl, appUrl, ownerUrl } from './env';

const API_DIR = join(__dirname, '..', '..');
const PRISMA_BIN = join(API_DIR, 'node_modules', '.bin', 'prisma');

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

  run(PRISMA_BIN, ['migrate', 'deploy']);

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

  run(join(API_DIR, 'node_modules', '.bin', 'ts-node'), [
    '--transpile-only',
    join('prisma', 'seed.ts'),
  ]);
}
