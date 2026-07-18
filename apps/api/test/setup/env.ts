/**
 * Connection strings for the integration suite.
 *
 * Two of them, deliberately, because that split is the whole point of the suite: the API runs as
 * a NON-OWNER role so row-level security actually applies, while migrations, the seed and the
 * tests' own assertions run as the owner, which policies do not apply to. Pointing both at the
 * same role would make every test pass while protecting nothing.
 *
 * Both are derived from DATABASE_URL so a developer needs no extra configuration, and so CI can
 * reuse its existing Postgres service container.
 */

/** Database the suite owns outright — it is migrated, seeded and mutated on every run. */
export const INTEGRATION_DB = process.env.INTEGRATION_DB ?? 'eyo_sms_it';

/** The non-owner runtime role. Its password is test-only and may safely live in the repo. */
export const APP_ROLE = process.env.APP_DB_ROLE ?? 'eyo_app';
export const APP_ROLE_PASSWORD = process.env.APP_DB_PASSWORD ?? 'eyo_app_test';

function baseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. The integration suite needs a real PostgreSQL server; point ' +
        'DATABASE_URL at one (the owner role) and the suite derives the rest.',
    );
  }
  return new URL(raw);
}

/** Owner connection to the integration database: migrations, seed, and test assertions. */
export function ownerUrl(): string {
  const url = baseUrl();
  url.pathname = `/${INTEGRATION_DB}`;
  return url.toString();
}

/** Owner connection to the server's default database, for CREATE DATABASE / CREATE ROLE. */
export function adminUrl(): string {
  const url = baseUrl();
  url.pathname = '/postgres';
  return url.toString();
}

/**
 * The connection the API under test uses. Non-owner, so every policy applies to it — this is
 * what makes a missing tenant scope show up as a failing test rather than a silent leak.
 */
export function appUrl(): string {
  const url = baseUrl();
  url.pathname = `/${INTEGRATION_DB}`;
  url.username = APP_ROLE;
  url.password = APP_ROLE_PASSWORD;
  return url.toString();
}
