import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The licensing portal, end to end.
 *
 * This covers the product's commercial loop — a school's server reports in, the vendor records it,
 * sells it a package, and the school installs what came back — which until now was checked only by
 * unit tests over the pure pieces and by hand in a browser. Every part of that loop is a place a
 * mistake costs money or reaches a customer.
 *
 * Requires the portal on :3200 and its fixtures:
 *   pnpm --filter @eyo/vendor db:seed        # a member of staff to sign in as
 *   pnpm --filter @eyo/vendor db:seed:e2e    # 26 client schools for the list tests
 *
 * The fixture seed is idempotent and owns every row prefixed `e2e-fixture-`, so the counts below
 * hold on the tenth run as well as the first. Tests that create their own schools stamp them with
 * a per-run id for the same reason — a suite that passes on the previous run's rows is worse than
 * one that fails, because it looks like coverage.
 */

const STAFF = { email: 'vendor@klasio.test', password: 'Password1!' };
const FIXTURE_PREFIX = 'e2e-fixture-';

/** What the fixture seed provisions. Mirrors `EXPECTED` in prisma/seed-e2e.ts. */
const FIXTURES = { ATTENTION: 2, EXPIRED: 2, SILENT: 2, EXPIRING: 3, UNLICENSED: 2, OK: 15 };
const FIXTURE_TOTAL = 26;

/** Unique per run, so a school this file creates can never be one a previous run left behind. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.beforeEach(async ({ page }) => {
  // Freeze entrance animations so a screenshot on failure shows the finished page.
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  });
  await signIn(page);
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(STAFF.email);
  await page.getByLabel('Password').fill(STAFF.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Client schools' })).toBeVisible();
}

/**
 * A fixture's row, found by slug rather than by name.
 *
 * Names collide: this database also holds real clients, and one of them is called "Kwahu Ridge
 * Academy" too. The slug is what a licence binds to and what the schema makes unique, so it is
 * the only handle that means one school — in the product as well as in this file.
 */
function fixtureRow(page: Page, slugStem: string) {
  return page.getByRole('row').filter({ hasText: `${FIXTURE_PREFIX}${slugStem}` });
}

/** A school's server reporting to its supplier. The one request a school's box ever makes. */
async function report(page: Page, body: Record<string, unknown>): Promise<number> {
  const res = await page.request.post('/api/heartbeat', {
    data: { v: 1, appVersion: '0.1.0', sentAt: new Date().toISOString(), ...body },
  });
  return res.status();
}

test.describe('the licensing portal', () => {
  test('signing in is required to see anyone', async ({ page }) => {
    // beforeEach already signed in; prove the guard by dropping the session.
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client schools' })).toBeHidden();
  });

  /**
   * The whole commercial loop in one test, because the value is in the seams between the steps —
   * a report arriving for a slug nobody has recorded, and a licence that has to verify on a
   * machine the portal does not control.
   */
  test('an unknown server reports, is recorded, and is sold a package', async ({ page }) => {
    const slug = `e2e-run-${RUN}`;
    const name = `Run ${RUN} Academy`;

    // 1. A school's server reports before the vendor has recorded it.
    expect(
      await report(page, {
        schoolSlug: slug,
        state: 'MISSING',
        students: 214,
        verifiedWith: 'none',
      }),
    ).toBe(202);

    await page.goto('/');
    const unrecorded = page.locator('section').filter({ hasText: 'Servers still to be recorded' });
    await expect(unrecorded.getByText(slug, { exact: true })).toBeVisible();

    // 2. Recording it under the same slug claims the reports it already sent.
    await page.getByRole('button', { name: 'Add school' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('School name').fill(name);
    await dialog.getByLabel('Slug').fill(slug);
    await dialog.getByRole('button', { name: 'Add school' }).click();

    await expect(dialog).toBeHidden();
    /*
      The slug leaves the unrecorded list precisely because its history moved to the new client.
      Asserted on this run's slug rather than on the panel disappearing: another test, or a real
      server, may be unrecorded at the same moment and that is none of this test's business.
    */
    await expect(unrecorded.getByText(slug, { exact: true })).toBeHidden();

    // 3. It now has a row, and nothing has been sold to it yet. Case-insensitive: the status pill
    // is uppercased by CSS, so the DOM says "Awaiting licence".
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText(/awaiting licence/i);

    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('The first licence issued will appear here.')).toBeVisible();
    // The claimed report is on the detail page — proof the history came across, not just the slug.
    await expect(page.getByText('214')).toBeVisible();

    // 4. Sell it a package, plus one feature from a higher one.
    await expect(page.getByRole('heading', { name: 'Issue a licence' })).toBeVisible();
    await page.getByLabel('Package').selectOption('MEDIUM');
    await page.getByRole('checkbox', { name: 'AI report remarks' }).check();
    await page.getByRole('button', { name: 'Issue licence' }).click();

    const issued = page.getByText(/MEDIUM · /).first();
    await expect(issued).toBeVisible();
    await expect(page.getByText('Plus AI report remarks')).toBeVisible();
    await expect(page.getByText('current', { exact: true })).toBeVisible();

    // 5. The signed text is what a school gets — so it has to be a licence a school will accept.
    await page.getByRole('button', { name: 'Show licence text' }).click();
    // `inputValue`, not text: it is rendered into a read-only textarea, whose value is a property
    // and whose text content is empty.
    const signed = (await page.locator('textarea').first().inputValue()).trim();
    expect(signed, 'the portal showed no licence text to copy').toMatch(/^[\w-]+\.[\w-]+$/);

    const payload = verifyAgainstSchoolKey(signed);
    // Bound to the slug, which is the only thing stopping a licence installing at another school.
    expect(payload.schoolSlug).toBe(slug);
    expect(payload.schoolName).toBe(name);
    expect(payload.tier).toBe('MEDIUM');
    expect(payload.extraEntitlements).toContain('ai.remarks');

    /*
      6. A renewal supersedes rather than edits.

      The licence table is history: support has to be able to see what a school was actually sent,
      not a description of the latest thing. So an upgrade leaves the old row in place, marked.
    */
    await page.getByLabel('Package').selectOption('ADVANCED');
    await page.getByRole('button', { name: 'Issue licence' }).click();

    await expect(page.getByText(/ADVANCED · /).first()).toBeVisible();
    await expect(page.getByText(/replaced /)).toBeVisible();
    await expect(page.getByText('current', { exact: true })).toHaveCount(1);
  });
});

/**
 * Finding one school among many — the reason the list grew a toolbar.
 *
 * These assert the wiring the unit tests cannot see: that a chip writes the URL, that the URL
 * drives the query, and that the counts beside the chips describe the whole set rather than the
 * page. All of them scope to the fixture prefix so a real client added by another test cannot
 * change the arithmetic.
 */
test.describe('finding a school in a long list', () => {
  test('searches by name and by slug', async ({ page }) => {
    await page.goto('/');
    const search = page.getByPlaceholder('Search by school or slug');

    /*
      Asserted on which schools came back rather than on a total. The name is a substring match
      against whatever this database holds, and a real client called "…Ridge…" would make an exact
      count a test about the fixtures' neighbours.
    */
    await search.fill('ridge');
    await expect(page).toHaveURL(/[?&]q=ridge/);
    for (const slug of ['kwahu-ridge-academy', 'bibiani-ridge-academy', 'akropong-ridge-school']) {
      await expect(fixtureRow(page, slug)).toBeVisible();
    }
    await expect(fixtureRow(page, 'cape-coast-girls')).toBeHidden();

    // By slug, which is what a support call actually has to hand — and unique to one fixture.
    await search.fill(`${FIXTURE_PREFIX}kwahu`);
    await expect(fixtureRow(page, 'kwahu-ridge-academy')).toBeVisible();
    await expect(page.getByText(/Showing 1–1 of 1/)).toBeVisible();

    await search.fill('there-is-no-such-school');
    await expect(
      page.getByText('Widen the search or pick another status to see more schools.'),
    ).toBeVisible();
  });

  test('chips filter, and their counts describe every school rather than the page', async ({
    page,
  }) => {
    // Scoped to the fixtures: the chips count everything the search matched, so an unscoped view
    // would be counting whatever else this database happens to hold.
    await page.goto(`/?q=${FIXTURE_PREFIX}`);

    // Counted across the whole matched set — the page below shows at most 25 of them.
    for (const [label, count] of [
      ['Needs a call', FIXTURES.ATTENTION],
      ['Expired', FIXTURES.EXPIRED],
      ['Silent', FIXTURES.SILENT],
      ['Expiring', FIXTURES.EXPIRING],
      ['Awaiting licence', FIXTURES.UNLICENSED],
    ] as const) {
      await expect(page.getByRole('link', { name: `${label} ${count}` })).toBeVisible();
    }

    await page.getByRole('link', { name: `Expiring ${FIXTURES.EXPIRING}` }).click();
    await expect(page).toHaveURL(/[?&]status=EXPIRING/);
    await expect(
      page.getByText(new RegExp(`Showing 1–${FIXTURES.EXPIRING} of ${FIXTURES.EXPIRING}`)),
    ).toBeVisible();

    // Every row that came back is in the state that was asked for, and nothing else did.
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(FIXTURES.EXPIRING);
    for (const row of await rows.all()) {
      // Case-insensitive: the pill is uppercased by CSS, so the DOM says "Expiring".
      await expect(row).toContainText(/expiring/i);
    }

    // Clicking the active chip clears it rather than trapping you in the filter.
    await page.getByRole('link', { name: `Expiring ${FIXTURES.EXPIRING}` }).click();
    await expect(page).not.toHaveURL(/status=/);
  });

  test('pages, and clamps a page that is past the end', async ({ page }) => {
    // Scoped to the fixtures so the totals hold however many real clients exist.
    await page.goto(`/?q=${FIXTURE_PREFIX}`);
    await expect(page.getByText(new RegExp(`Showing 1–25 of ${FIXTURE_TOTAL}`))).toBeVisible();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();

    await page.getByRole('link', { name: 'Next' }).click();
    await expect(
      page.getByText(new RegExp(`Showing 26–${FIXTURE_TOTAL} of ${FIXTURE_TOTAL}`)),
    ).toBeVisible();
    await expect(page).toHaveURL(/[?&]page=2/);

    await page.getByRole('link', { name: 'Previous' }).click();
    await expect(page.getByText(new RegExp(`Showing 1–25 of ${FIXTURE_TOTAL}`))).toBeVisible();

    /*
      The case URL state makes ordinary: bookmark page 4, narrow the filter, and page 4 is gone.

      It clamps to the nearest page that exists rather than to the first, which keeps you where you
      were looking. What matters either way is that rows come back — an empty table would read as
      "nothing matched" when the truth is "that page went".
    */
    await page.goto(`/?q=${FIXTURE_PREFIX}&page=99`);
    await expect(
      page.getByText(new RegExp(`Showing 26–${FIXTURE_TOTAL} of ${FIXTURE_TOTAL}`)),
    ).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  /** Two schools in the same state for different reasons; both are worth a phone call. */
  test('explains why a school needs attention', async ({ page }) => {
    await page.goto(`/?q=${FIXTURE_PREFIX}&status=ATTENTION`);

    await expect(fixtureRow(page, 'kwahu-ridge-academy')).toContainText('development key');
    await expect(fixtureRow(page, 'achimota-preparatory')).toContainText(
      /Running ADVANCED on a \w+ licence/,
    );
  });
});

/**
 * Verify a licence exactly as a school's server does — over the received bytes, with the public
 * half of the key.
 *
 * This is the assertion that makes the rest of the file about a product rather than about a form:
 * a portal that records a licence nobody can install has done nothing. Re-serialising the payload
 * to check it would defeat the point, since key order and whitespace are what a signature covers.
 */
function verifyAgainstSchoolKey(signed: string): {
  schoolSlug: string;
  schoolName: string;
  tier: string;
  extraEntitlements: string[];
} {
  const pem = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/.exec(
    readFileSync(join(process.cwd(), '..', '..', 'ops', 'licence', 'dev-public.pem'), 'utf8'),
  );
  if (!pem) throw new Error('No development public key on this machine to verify against');

  const [body, signature] = signed.split('.');
  const bytes = Buffer.from(body, 'base64url');
  const ok = cryptoVerify(
    null,
    bytes,
    createPublicKey(pem[0]),
    Buffer.from(signature, 'base64url'),
  );
  expect(ok, 'the portal issued a licence a school would refuse').toBe(true);

  return JSON.parse(bytes.toString('utf8'));
}
