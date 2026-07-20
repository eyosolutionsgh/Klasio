/**
 * A first member of vendor staff, so a fresh portal can be signed into.
 *
 * Idempotent: run it twice and it re-enrols the authenticator rather than failing, which is what
 * you actually want when someone has locked themselves out.
 */
import { ENTITLEMENT_CATALOGUE, includedIn, type LicenceTier } from '@eyo/shared';
import { PrismaClient } from '../node_modules/.prisma/vendor-client';
import { encryptSecret } from '../src/lib/crypto';
import { generateTotpSecret, readableSecret } from '../src/lib/totp';

const db = new PrismaClient();

async function main() {
  const email = (process.env.VENDOR_ADMIN_EMAIL ?? 'vendor@klasio.test').toLowerCase();
  const name = process.env.VENDOR_ADMIN_NAME ?? 'Klasio Licensing';

  /*
    The bootstrap account is enrolled here, not left to enrol itself.

    Second factors are required, so a seeded account with none would land on the setup screen — fine
    for a person, useless for the E2E suite, which has to be able to produce a valid code. Taking
    the secret from the environment when given keeps that honest: a real operator sets
    VENDOR_ADMIN_TOTP_SECRET to something only they hold, or scans the one printed below and then
    re-enrols.
  */
  const totpSecret = process.env.VENDOR_ADMIN_TOTP_SECRET || generateTotpSecret();
  await db.vendorUser.upsert({
    where: { email },
    create: {
      email,
      name,
      totpSecretEnc: encryptSecret(totpSecret),
      totpConfirmedAt: new Date(),
    },
    update: {
      active: true,
      totpSecretEnc: encryptSecret(totpSecret),
      totpConfirmedAt: new Date(),
      // A reseed is a reset: whatever was counting against this account stops counting.
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  console.log(`Vendor login: ${email}`);
  console.log(`Authenticator key: ${readableSecret(totpSecret)}`);
  console.log('Sign in with a code from that key, or with one emailed to the address above.');

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
