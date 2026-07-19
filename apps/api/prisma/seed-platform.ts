/**
 * EYO's own first account.
 *
 * Kept out of `seed.ts` on purpose: that seeds a demo *school*, and the vendor is not one. This
 * also has to run on a real deployment, where there are no demo schools at all but somebody
 * still has to be able to issue the first invitation.
 *
 * Idempotent. Reads the password from PLATFORM_ADMIN_PASSWORD and refuses to invent one outside
 * development — a known default password on the account that can suspend every school is not a
 * convenience worth having.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../src/common/crypto';

const db = new PrismaClient();

const DEV_PASSWORD = 'Platform1!';

async function main() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@eyo.gh').toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME ?? 'Klasio Platform Admin';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';

  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be set to seed a platform admin in production');
  }
  const plain = password || DEV_PASSWORD;
  const passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);

  const admin = await db.platformAdmin.upsert({
    where: { email },
    // An existing account keeps its password: re-running the seed must not reset a real one.
    update: { name, active: true },
    create: { email, name, passwordHash },
    select: { id: true, email: true, createdAt: true, updatedAt: true },
  });

  const created = admin.createdAt.getTime() === admin.updatedAt.getTime();
  console.log(`Platform admin ${created ? 'created' : 'already present'}: ${admin.email}`);
  if (created && !password) console.log(`  development password: ${plain}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
