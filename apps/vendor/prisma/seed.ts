/**
 * A first member of vendor staff, so a fresh portal can be signed into.
 *
 * Idempotent: run it twice and it resets the password rather than failing, which is what you
 * actually want when someone has locked themselves out.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../node_modules/.prisma/vendor-client';

const db = new PrismaClient();

async function main() {
  const email = (process.env.VENDOR_ADMIN_EMAIL ?? 'vendor@klasio.test').toLowerCase();
  const password = process.env.VENDOR_ADMIN_PASSWORD ?? 'Password1!';
  const name = process.env.VENDOR_ADMIN_NAME ?? 'Klasio Licensing';

  const passwordHash = await bcrypt.hash(password, 10);
  await db.vendorUser.upsert({
    where: { email },
    create: { email, name, passwordHash },
    update: { passwordHash, active: true },
  });
  console.log(`Vendor login: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
