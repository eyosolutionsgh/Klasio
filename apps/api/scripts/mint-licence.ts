/**
 * Mint a Klasio licence. Vendor-side tool — this is what turns a sale into a file a school
 * installs.
 *
 *   pnpm --filter @eyo/api licence:new-key            # once, ever
 *   pnpm --filter @eyo/api licence:mint -- \
 *     --key vendor-signing-key.pem \
 *     --school "Brighton Academy" --slug brighton-academy \
 *     --tier MEDIUM --months 12
 *
 * With no --key it signs with the DEVELOPMENT key committed at ops/licence/dev-signing-key.pem,
 * which is right for a local box and useless in production: the API refuses the matching public
 * key when NODE_ENV=production, precisely because that private half is public.
 *
 * It imports `signLicence` from the product rather than reimplementing it. Two implementations of
 * the same byte layout is how you get a licence that mints cleanly and fails to verify.
 */
import { generateKeyPairSync } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Tier } from '@prisma/client';
import { signLicence, type LicencePayload } from '../src/licence/licence';

const DEV_KEY_PATH = join(__dirname, '../../../ops/licence/dev-signing-key.pem');
const TIERS: Tier[] = ['BASIC', 'MEDIUM', 'ADVANCED'];
const DEFAULT_CAPS: Record<Tier, number | null> = { BASIC: 150, MEDIUM: 1000, ADVANCED: null };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
const has = (name: string) => process.argv.includes(`--${name}`);

function newKey(): never {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(
    'vendor-signing-key.pem',
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    {
      mode: 0o600,
    },
  );
  console.log('Private key written to ./vendor-signing-key.pem (mode 600). Back it up offline.');
  console.log('\nSet this on every school deployment as LICENCE_PUBLIC_KEY:\n');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  process.exit(0);
}

function main() {
  if (has('new-key')) newKey();

  const schoolName = arg('school');
  const schoolSlug = arg('slug');
  if (!schoolName || !schoolSlug) {
    console.error(
      'Usage: licence:mint -- --school "Name" --slug the-slug [--tier MEDIUM] [--months 12]\n' +
        '                       [--cap 500|unlimited] [--extra code,code] [--grace 30] [--key path] [--out file]',
    );
    process.exit(1);
  }

  const tier = (arg('tier') ?? 'MEDIUM').toUpperCase() as Tier;
  if (!TIERS.includes(tier)) {
    console.error(`Unknown tier "${tier}" — expected BASIC, MEDIUM or ADVANCED.`);
    process.exit(1);
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + Number(arg('months') ?? 12));

  // No --cap means "whatever the tier says"; --cap unlimited is the explicit no-ceiling case, and
  // the two must stay distinguishable — null in a payload means unlimited, not "unspecified".
  const capArg = arg('cap');
  const studentCap =
    capArg === undefined ? DEFAULT_CAPS[tier] : capArg === 'unlimited' ? null : Number(capArg);

  const payload: LicencePayload = {
    v: 1,
    licenceId: arg('id') || `lic_${now.getFullYear()}_${String(now.getTime()).slice(-6)}`,
    schoolName,
    schoolSlug,
    tier,
    studentCap,
    extraEntitlements: (arg('extra') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: Number(arg('grace') ?? 30),
  };

  const keyPath = arg('key');
  let privatePem: string;
  if (keyPath) {
    privatePem = readFileSync(keyPath, 'utf8');
  } else {
    // The dev key file carries an explanatory header above the PEM; take only the PEM.
    const raw = readFileSync(DEV_KEY_PATH, 'utf8');
    privatePem = raw.slice(raw.indexOf('-----BEGIN PRIVATE KEY-----'));
    console.error(
      'WARNING: signing with the committed DEVELOPMENT key. Not valid in production.\n',
    );
  }

  const licence = signLicence(payload, privatePem);
  const out = arg('out');
  if (out) {
    writeFileSync(out, licence + '\n');
    console.error(`Licence written to ${out}`);
  } else {
    console.log(licence);
  }
  console.error(
    `\n${payload.schoolName} (${payload.schoolSlug}) — ${payload.tier}, cap ${payload.studentCap ?? 'unlimited'}, ` +
      `expires ${payload.expiresAt.slice(0, 10)}, ${payload.graceDays}d grace`,
  );
}

main();
