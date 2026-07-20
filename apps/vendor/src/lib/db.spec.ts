import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('the vendor database client', () => {
  const original = process.env.VENDOR_DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.VENDOR_DATABASE_URL;
    else process.env.VENDOR_DATABASE_URL = original;
  });

  // The "nothing is constructed at import" half lives in db-import.spec.ts: it needs the generated
  // client mocked, and a module mock cannot be un-registered reliably mid-file. Vitest isolates
  // the module registry per file, so a separate file is what keeps it from leaking into these.

  /**
   * Both tests set the environment AFTER importing, never before. Importing the generated client
   * loads apps/vendor/.env into process.env, so a value cleared beforehand is quietly restored —
   * which made an earlier version of this test pass on a machine with a .env and mean nothing.
   */

  /**
   * Deferring must not become swallowing. A portal that starts against no database and then serves
   * empty pages is worse than one that refuses, so the first real query still fails — and names the
   * variable, which Prisma's own message does not.
   */
  it('fails on first use, naming the variable that is missing', async () => {
    const { db } = await import('./db');
    delete process.env.VENDOR_DATABASE_URL;

    expect(() => db.licence).toThrow(/VENDOR_DATABASE_URL/);
  });

  /**
   * A lazy getter's easiest way to be worse than the eager version it replaced: rebuilding the
   * client on every property access, opening a fresh pool each time. The instance must be reused.
   */
  it('builds the client once and reuses it', async () => {
    const { db } = await import('./db');
    process.env.VENDOR_DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/db';

    expect(db.licence).toBe(db.licence);
  });
});
