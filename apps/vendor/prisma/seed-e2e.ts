/**
 * Fixture clients for the E2E suite, enough of them to have a second page.
 *
 * The list controls only mean anything at a size a person cannot take in at once, and 26 clients
 * is the smallest number that pages at all (`PAGE_SIZE` is 25). Provisioning them through the UI
 * would mean 26 dialog submissions per run, and would leave the count creeping upwards until the
 * paging assertions stopped describing anything.
 *
 * So: a seed, and an idempotent one. Every row it owns carries the `E2E_PREFIX` slug prefix and is
 * deleted before being written again, which is what lets the suite assert an exact total — run it
 * ten times and there are still 26.
 *
 * The health spread is deliberate. Each status chip needs something behind it, and the counts the
 * spec asserts are the point of the chips: they describe the whole matched set rather than the
 * page you are looking at, which is the bug this arrangement exists to catch.
 *
 *   pnpm --filter @eyo/vendor db:seed:e2e
 */
import { PrismaClient, type Tier } from '../node_modules/.prisma/vendor-client';

const db = new PrismaClient();

/** Every fixture row starts with this, so the seed can find and replace exactly its own. */
export const E2E_PREFIX = 'e2e-fixture-';

/** What a spec stamps onto a school it creates for itself. Swept here, never asserted on. */
export const RUN_PREFIX = 'e2e-run-';

const DAY = 86_400_000;

/**
 * 26 schools: one page of 25 and one more.
 *
 * Names are deliberately unalike so a search can pick out a few of them — `ridge` matches three
 * and nothing else, which is what the search test asserts.
 */
const NAMES = [
  'Kwahu Ridge Academy',
  'Bibiani Ridge Academy',
  'Akropong Ridge School',
  'Achimota Preparatory',
  'Cape Coast Girls',
  'Sunyani Model School',
  'Ho Grammar',
  'Tamale International',
  'Aburi Hill School',
  'Elmina Bay Academy',
  'Koforidua Presby',
  'Takoradi Harbour School',
  'Wa Community School',
  'Bolgatanga Central',
  'Nsawam Valley Academy',
  'Winneba Shore School',
  'Obuasi Gold Academy',
  'Sekondi Anglican',
  'Techiman Unity School',
  'Dodowa Green School',
  'Madina Grace Academy',
  'Tema Meridian School',
  'Kasoa Bright Star',
  'Swedru Methodist',
  'Nkawkaw Rock School',
  'Berekum Faith Academy',
];

/**
 * Which state each fixture lands in, spelled out rather than computed from an index.
 *
 * A modulo would be shorter and would make the expected counts something a reader has to work out
 * — and the spec asserts those counts, so they need to be readable in one place.
 */
type Health = 'ATTENTION' | 'EXPIRED' | 'SILENT' | 'EXPIRING' | 'UNLICENSED' | 'OK';
const PLAN: Health[] = [
  'ATTENTION', // Kwahu Ridge — verifying with a development key
  'OK', // Bibiani Ridge
  'OK', // Akropong Ridge
  'ATTENTION', // Achimota — running a package it did not buy
  'EXPIRED',
  'EXPIRED',
  'SILENT',
  'SILENT',
  'EXPIRING',
  'EXPIRING',
  'EXPIRING',
  'UNLICENSED',
  'UNLICENSED',
  ...(Array(13).fill('OK') as Health[]),
];

/** What the spec expects each chip to read. Exported so the two cannot drift apart. */
export const EXPECTED = {
  ATTENTION: 2,
  EXPIRED: 2,
  SILENT: 2,
  EXPIRING: 3,
  UNLICENSED: 2,
  OK: 15,
  TOTAL: 26,
};

const slugOf = (name: string) =>
  E2E_PREFIX +
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function main() {
  if (NAMES.length !== PLAN.length || NAMES.length !== EXPECTED.TOTAL) {
    throw new Error(`Fixture sizes disagree: ${NAMES.length} names, ${PLAN.length} plans`);
  }

  // Its own rows only. Cascades take the licences and heartbeats with them.
  const { count } = await db.client.deleteMany({ where: { slug: { startsWith: E2E_PREFIX } } });
  // Orphaned reports carry no client to cascade from, so they are cleared by slug.
  await db.heartbeat.deleteMany({ where: { schoolSlug: { startsWith: E2E_PREFIX } } });

  /*
    Schools the suite creates for itself, stamped per run so they cannot be mistaken for each
    other. They are outside the fixture set on purpose — a test that writes must never move a
    number another test asserts — which also means nothing else would ever tidy them up.
  */
  await db.client.deleteMany({ where: { slug: { startsWith: RUN_PREFIX } } });
  await db.heartbeat.deleteMany({ where: { schoolSlug: { startsWith: RUN_PREFIX } } });

  const now = Date.now();

  for (const [i, name] of NAMES.entries()) {
    const health = PLAN[i];
    const tier: Tier = (['BASIC', 'MEDIUM', 'ADVANCED'] as Tier[])[i % 3];
    const client = await db.client.create({
      data: {
        name,
        slug: slugOf(name),
        contactName: 'Head Teacher',
        contactEmail: `head@${slugOf(name)}.test`,
      },
    });

    if (health === 'UNLICENSED') continue;

    const expiresAt = new Date(
      health === 'EXPIRED'
        ? now - 90 * DAY
        : health === 'EXPIRING'
          ? now + 12 * DAY // inside the 30-day warning window
          : now + 300 * DAY,
    );

    await db.licence.create({
      data: {
        clientId: client.id,
        licenceId: `${E2E_PREFIX}lic_${i}`,
        tier,
        extraEntitlements: [],
        issuedAt: new Date(now - 60 * DAY),
        expiresAt,
        graceDays: 30,
        signed: 'fixture.not-a-real-licence',
      },
    });

    await db.heartbeat.create({
      data: {
        clientId: client.id,
        schoolSlug: client.slug,
        licenceId: `${E2E_PREFIX}lic_${i}`,
        state: 'VALID',
        // ATTENTION arrives two different ways, and the dashboard ranks them the same. Index 0
        // tampers with the key; index 3 runs a package it was not sold.
        tierInForce: i === 3 ? 'ADVANCED' : tier,
        tierLicensed: tier,
        students: 120 + i * 7,
        verifiedWith: i === 0 ? 'development' : 'vendor',
        appVersion: '0.1.0',
        raw: {},
        // SILENT is the absence of a recent report, so it is set by dating the last one.
        receivedAt: new Date(now - (health === 'SILENT' ? 9 * DAY : 4 * 3_600_000)),
      },
    });
  }

  console.log(
    `Vendor E2E fixtures: replaced ${count}, wrote ${NAMES.length} clients under "${E2E_PREFIX}".`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
