/**
 * The vendor's Prisma client.
 *
 * Its own generated client (`.prisma/vendor-client`) against its own database, so nothing here can
 * accidentally reach a school's records: there is no connection string in this process that points
 * at one.
 *
 * Built on first use rather than at import. `next build` evaluates every route module to collect
 * its config, so a client constructed at module load ran during the build and threw "Invalid value
 * undefined for datasource db" on any machine without VENDOR_DATABASE_URL — which is every Docker
 * build, since compiling queries nothing. Deferring it moves the requirement to the first actual
 * query, which is the moment the database is genuinely needed.
 */
import { PrismaClient } from '../../node_modules/.prisma/vendor-client';

const globalForPrisma = globalThis as unknown as { vendorDb?: PrismaClient };

/**
 * Module-level, NOT only the dev global. In production `globalForPrisma.vendorDb` is deliberately
 * never set, so without this every property access would construct a fresh client and open a fresh
 * pool — a lazy getter's easiest way to be much worse than the eager version it replaced.
 */
let cached: PrismaClient | undefined;

function client(): PrismaClient {
  const existing = cached ?? globalForPrisma.vendorDb;
  if (existing) return existing;

  const url = process.env.VENDOR_DATABASE_URL;
  // Named explicitly: Prisma's own message reports an undefined datasource without saying which
  // variable is missing, and this is the one a fresh deployment forgets.
  if (!url) {
    throw new Error(
      'VENDOR_DATABASE_URL is not set — the licensing portal cannot reach its database.',
    );
  }

  const created = new PrismaClient({ datasources: { db: { url } } });
  cached = created;
  // Next's dev server re-evaluates modules on every change; without this each edit opens a new pool.
  if (process.env.NODE_ENV !== 'production') globalForPrisma.vendorDb = created;
  return created;
}

/**
 * Stands in for the client and builds it on first property access. Functions are bound to the real
 * instance so `db.$transaction(...)` and `db.licence.findMany(...)` behave exactly as before —
 * every call site is unchanged.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
