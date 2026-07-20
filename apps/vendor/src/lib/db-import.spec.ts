import { describe, expect, it, vi } from 'vitest';

/**
 * Its own file because it mocks the generated Prisma client, and a module mock cannot be
 * un-registered reliably part-way through a file — sharing db.spec.ts made the mocked constructor
 * leak into the tests after it. Vitest isolates the module registry per file, which is the
 * isolation this needs. The rest of the client's behaviour is covered in db.spec.ts.
 */
const constructor = vi.fn();
vi.mock('../../node_modules/.prisma/vendor-client', () => ({ PrismaClient: constructor }));

describe('importing the vendor database client', () => {
  /**
   * The regression this guards. `next build` evaluates every route module to collect its config,
   * so a client constructed at import ran during the build — and failed the vendor image twice
   * with "Invalid value undefined for datasource db", because a Docker build has no database and
   * needs none.
   *
   * Asserted as "the constructor was never called", not as "importing did not throw": the eager
   * version did not throw under vitest either, so that weaker check passed against the very code
   * this exists to catch, and proved nothing.
   */
  it('constructs no client, because compiling queries nothing', async () => {
    delete process.env.VENDOR_DATABASE_URL;

    await import('./db');

    expect(constructor).not.toHaveBeenCalled();
  });
});
