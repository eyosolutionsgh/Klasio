/**
 * A first member of vendor staff, so a fresh portal can be signed into.
 *
 * Idempotent: run it twice and it resets the password rather than failing, which is what you
 * actually want when someone has locked themselves out.
 */
import bcrypt from 'bcryptjs';
import { ENTITLEMENT_CATALOGUE, includedIn, type LicenceTier } from '@eyo/shared';
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

  /*
    The three built-in tiers, as packages to start from.

    A fresh portal with no packages cannot issue anything, and asking someone to rebuild Basic from
    forty checkboxes before their first sale is a poor welcome. These are ordinary packages once
    created — rename them, change what is in them, add others alongside. Only created when missing,
    so an edit is never undone by re-running the seed.
  */
  const STARTERS: { name: string; tier: LicenceTier; description: string }[] = [
    {
      name: 'Basic',
      tier: 'BASIC',
      description: 'Records, attendance, terminal reports, fees by hand.',
    },
    {
      name: 'Medium',
      tier: 'MEDIUM',
      description: 'Adds online payments, pickup safety and automated messaging.',
    },
    {
      name: 'Advanced',
      tier: 'ADVANCED',
      description: 'Everything, including the AI suite and WhatsApp.',
    },
  ];

  for (const starter of STARTERS) {
    const existing = await db.package.findUnique({ where: { name: starter.name } });
    if (existing) continue;
    await db.package.create({
      data: {
        name: starter.name,
        description: starter.description,
        tier: starter.tier,
        entitlements: ENTITLEMENT_CATALOGUE.filter((e) => includedIn(starter.tier).has(e.code)).map(
          (e) => e.code,
        ),
      },
    });
    console.log(`Package "${starter.name}" created.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
