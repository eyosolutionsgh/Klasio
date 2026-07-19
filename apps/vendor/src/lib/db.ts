/**
 * The vendor's Prisma client.
 *
 * Its own generated client (`.prisma/vendor-client`) against its own database, so nothing here can
 * accidentally reach a school's records: there is no connection string in this process that points
 * at one.
 */
import { PrismaClient } from '../../node_modules/.prisma/vendor-client';

const globalForPrisma = globalThis as unknown as { vendorDb?: PrismaClient };

export const db =
  globalForPrisma.vendorDb ??
  new PrismaClient({ datasources: { db: { url: process.env.VENDOR_DATABASE_URL } } });

// Next's dev server re-evaluates modules on every change; without this each edit opens a new pool.
if (process.env.NODE_ENV !== 'production') globalForPrisma.vendorDb = db;
