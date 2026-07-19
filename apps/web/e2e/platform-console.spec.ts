import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * EYO's own console — what the vendor can do, and what nobody else can.
 *
 * The four powers the platform owner needs (provision, list, suspend, contact) are each checked
 * through the screens. The isolation checks matter just as much: this is the one principal in
 * the product that crosses tenant boundaries, so "a school cannot reach it" is not a detail.
 *
 * Every test stands on its own: each puts the school into the state it needs before measuring,
 * through the API rather than through the screens, so running one with `-g` works and a failure
 * reports one problem instead of hiding the three after it. It also asserts nothing about the
 * demo schools, so it does not quietly depend on which seeds were last run.
 *
 * Needs the stack up and `pnpm --filter @eyo/api db:seed:platform`.
 */

const SHOTS = 'e2e/screenshots/platform';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const API_DIR = path.resolve(__dirname, '../../api');

const PLATFORM = { email: 'admin@eyo.gh', password: 'Platform1!' };

/** The school this suite provisions. Purged first so a re-run starts from nothing. */
const INVITED = {
  school: 'Kwahu Ridge Academy',
  owner: 'proprietor@kwahu-ridge.test',
  password: 'RidgeFirst1!',
};

/**
 * Wording each test can recognise as its own.
 *
 * The school accumulates history across tests and across runs, so two tests writing the same
 * sentence would leave assertions matching several rows — ambiguous rather than failing, which
 * is the harder kind of wrong to notice.
 */
const SUSPEND_REASON = 'Subscription unpaid for two terms';
const NOTICE_SUBJECT = 'Payment overdue';
const DETAIL_REASON = 'Reviewing this account';
const DETAIL_NOTICE = 'Account under review';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  });
});

function purge() {
  execFileSync(
    'pnpm',
    ['exec', 'ts-node', '--transpile-only', 'prisma/e2e-purge-registered-school.ts', INVITED.owner],
    { cwd: API_DIR, encoding: 'utf8' },
  );
}

async function signInAsPlatform(page: Page) {
  await page.goto('/platform/login');
  await page.getByLabel('Email address').fill(PLATFORM.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PLATFORM.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/platform/schools');
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

/**
 * Act as the vendor against the API directly.
 *
 * Setup only. The tests drive the console itself — this exists so a test can arrive at the state
 * it wants to measure without re-performing, and re-asserting, everything before it.
 */
async function vendor<T = unknown>(
  page: Page,
  path: string,
  init?: { method?: 'GET' | 'POST'; data?: unknown },
): Promise<T> {
  const signIn = await page.request.post(`${API}/platform/auth/login`, { data: PLATFORM });
  expect(signIn.ok(), 'the platform admin seed must be present — db:seed:platform').toBeTruthy();
  const { token } = await signIn.json();

  const res =
    init?.method === 'POST'
      ? await page.request.post(`${API}/platform/${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          data: init.data ?? {},
        })
      : await page.request.get(`${API}/platform/${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
  expect(res.ok(), `vendor ${path} failed: ${await res.text()}`).toBeTruthy();
  return res.json() as Promise<T>;
}

interface Listed {
  id: string;
  name: string;
  suspended: boolean;
}

/**
 * This suite's school, existing and not suspended, however it was left last time.
 *
 * Registration is vendor-initiated, so creating it means being the vendor first: issue an
 * invitation, then accept it as the school. That is the same path test 2 walks through the
 * screens — done here in two calls so the tests after it have something to act on.
 */
async function ensureSchool(page: Page): Promise<Listed> {
  const find = async () =>
    (await vendor<Listed[]>(page, `schools?q=${encodeURIComponent(INVITED.school)}`)).find(
      (s) => s.name === INVITED.school,
    );

  let school = await find();
  if (!school) {
    // A leftover account on this address would refuse the invitation, correctly.
    purge();
    const invite = await vendor<{ token: string }>(page, 'invitations', {
      method: 'POST',
      data: { schoolName: INVITED.school, email: INVITED.owner },
    });
    const res = await page.request.post('/api/register', {
      data: {
        token: invite.token,
        schoolName: INVITED.school,
        ownerName: 'Mr. Kofi Boateng',
        email: INVITED.owner,
        password: INVITED.password,
      },
    });
    expect(res.ok(), 'setup: the invited school should be able to register').toBeTruthy();
    school = await find();
  }
  expect(school, 'setup: the school should exist by now').toBeTruthy();

  // Left suspended by an earlier test or an earlier run — put the door back on its hinges.
  if (school!.suspended) {
    await vendor(page, `schools/${school!.id}/restore`, { method: 'POST' });
    school!.suspended = false;
  }
  return school!;
}

/** The suspended state, for a test whose subject is coming back from it. */
async function ensureSuspended(page: Page, id: string, reason: string) {
  const { suspended } = await vendor<{ suspended: boolean }>(page, `schools/${id}`);
  if (!suspended) {
    await vendor(page, `schools/${id}/suspend`, { method: 'POST', data: { reason } });
  }
}

test.describe('the platform owner', () => {
  test('1 · signs in to a console that lists every school', async ({ page }) => {
    const school = await ensureSchool(page);
    const all = await vendor<Listed[]>(page, 'schools');

    await signInAsPlatform(page);
    await shot(page, '01-schools');

    // "Every school" checked against what the API actually holds, rather than against the demo
    // fixtures — which schools happen to be seeded is not this suite's business.
    const rows = page.getByRole('row').filter({ has: page.getByRole('link') });
    await expect(rows).toHaveCount(all.length);
    await expect(page.getByRole('link', { name: school.name })).toBeVisible();

    // Cross-tenant by design: the only screen in the product where two schools appear at once,
    // which is exactly why everything else is fenced.
    expect(all.length, 'the console is only interesting with more than one school').toBeGreaterThan(
      1,
    );
  });

  test('2 · provisions a school by invitation, and the school completes it', async ({ page }) => {
    purge();
    await signInAsPlatform(page);

    await page.getByRole('button', { name: 'invitations' }).click();
    await page.getByPlaceholder('School name').fill(INVITED.school);
    await page.getByPlaceholder("Proprietor's email").fill(INVITED.owner);
    await page.getByRole('button', { name: 'Create invitation' }).click();

    // The link is shown once, here, and never again — it is stored only as a hash.
    const link = page.locator('code');
    await expect(link).toBeVisible();
    const url = (await link.textContent())!.trim();
    expect(url).toContain('/register?token=');
    await shot(page, '02-invitation-issued');

    // Scoped to this school's row throughout: the console lists every invitation ever issued,
    // so a bare text match would happily pass on somebody else's.
    const inviteRow = page.getByRole('row', { name: new RegExp(INVITED.school) });
    await expect(inviteRow).toBeVisible();
    await expect(inviteRow.getByText('OPEN', { exact: true })).toBeVisible();

    // Now be the school. A fresh context, because the vendor cookie must play no part in this.
    const asSchool = await page.context().browser()!.newContext();
    const tab = await asSchool.newPage();
    await tab.goto(url);
    await tab.getByLabel('Your name').fill('Mr. Kofi Boateng');
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Create school' }).click();
    await tab.waitForURL('**/settings/school', { timeout: 20000 });
    await shot(tab, '03-school-registered');
    await tab.close();
    await asSchool.close();

    await page.reload();
    await page.getByRole('button', { name: 'invitations' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(INVITED.school) }).getByText('ACCEPTED'),
      'the invitation should be spent once the school has used it',
    ).toBeVisible();
  });

  test('3 · suspends a school, which can no longer sign in', async ({ page }) => {
    await ensureSchool(page);
    await signInAsPlatform(page);

    const row = page.getByRole('row', { name: new RegExp(INVITED.school) });
    page.once('dialog', (d) => d.accept(SUSPEND_REASON));
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(
      page
        .getByRole('row', { name: new RegExp(INVITED.school) })
        .getByText('Suspended', { exact: true }),
    ).toBeVisible();
    await shot(page, '04-suspended');

    // The school is turned away, and told why rather than left guessing at a password.
    const asSchool = await page.context().browser()!.newContext();
    const tab = await asSchool.newPage();
    await tab.goto('/login');
    await tab.getByLabel('Email address').fill(INVITED.owner);
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Log in' }).click();
    await expect(tab).toHaveURL(/\/login/);
    await shot(tab, '05-suspended-school-login');
    await tab.close();
    await asSchool.close();
  });

  test('4 · writes to a school, and restores it', async ({ page }) => {
    // Restoring needs something to restore from, so this test suspends the school itself rather
    // than inheriting the one above's leftovers.
    const school = await ensureSchool(page);
    await ensureSuspended(page, school.id, SUSPEND_REASON);
    await signInAsPlatform(page);

    const row = page.getByRole('row', { name: new RegExp(INVITED.school) });
    await row.getByRole('button', { name: 'Contact' }).click();
    await page.getByPlaceholder('Subject').fill(NOTICE_SUBJECT);
    await page
      .getByPlaceholder('Message')
      .fill('Please settle your subscription so we can restore access.');
    await page.getByLabel('Needs their attention').check();
    await shot(page, '06-writing-a-notice');
    await page.getByRole('button', { name: 'Send notice' }).click();
    await expect(page.getByText(/Notice sent to/)).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page
      .getByRole('row', { name: new RegExp(INVITED.school) })
      .getByRole('button', { name: 'Restore' })
      .click();
    await expect(page.getByText(/restored/i).first()).toBeVisible();
    await shot(page, '07-restored');

    // The school is back in, and finds the vendor's message waiting inside the portal.
    const asSchool = await page.context().browser()!.newContext();
    const tab = await asSchool.newPage();
    await tab.goto('/login');
    await tab.getByLabel('Email address').fill(INVITED.owner);
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Log in' }).click();
    await tab.waitForURL('**/dashboard');
    await expect(tab.getByText('Message from Klasio').first()).toBeVisible();
    await expect(tab.getByText(NOTICE_SUBJECT).first()).toBeVisible();
    await shot(tab, '08-school-sees-notice');
    await tab.close();
    await asSchool.close();
  });

  test('5 · opens one school in full, and shows what was done to it', async ({ page }) => {
    const school = await ensureSchool(page);

    /**
     * Give this school a history of its own rather than inheriting one.
     *
     * The wording is distinct from the tests above on purpose: those may have left their own
     * suspension and notice on the same school, and two rows reading the same thing would make
     * the assertions below ambiguous rather than wrong — which is worse.
     */
    // Stamped, so the assertions below match *this* run's rows. The history is cumulative and
    // the page shows the last twenty, so fixed wording would match several after a few runs —
    // and an assertion that passes on a previous run's data is not testing anything.
    const stamp = Date.now();
    const reason = `${DETAIL_REASON} ${stamp}`;
    const notice = `${DETAIL_NOTICE} ${stamp}`;

    await vendor(page, `schools/${school.id}/suspend`, { method: 'POST', data: { reason } });
    await vendor(page, `schools/${school.id}/restore`, { method: 'POST' });
    await vendor(page, `schools/${school.id}/contact`, {
      method: 'POST',
      data: { subject: notice, body: 'A routine check of the subscription.', level: 'INFO' },
    });

    await signInAsPlatform(page);
    await page.getByRole('link', { name: INVITED.school }).click();
    await page.waitForURL(/\/platform\/schools\/[^/]+$/);
    await expect(page.getByRole('heading', { name: INVITED.school })).toBeVisible();

    // Who runs it, and what they are worth — the two questions a vendor opens a school for.
    await expect(page.getByText(INVITED.owner)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who runs it' })).toBeVisible();

    // The history is the point: a suspension nobody can review later is not accountable.
    // Each assertion is scoped to its own section — the two lists quote each other's wording,
    // so an unscoped match can find the right words in the wrong place.
    const said = page.locator('section').filter({ hasText: 'What Klasio has said' });
    await expect(said.getByText(notice)).toBeVisible();

    const done = page.locator('section').filter({ hasText: 'What Klasio has done' });
    await expect(done.getByText('Suspended the school').first()).toBeVisible();
    await expect(done.getByText('Restored access').first()).toBeVisible();
    await expect(done.getByText(reason)).toBeVisible();
    await shot(page, '09-school-detail');

    // The same actions work from here, not just from the list.
    page.once('dialog', (d) => d.accept('Checking the detail page works'));
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText(/Suspended on/)).toBeVisible();
    await shot(page, '10-detail-suspended');

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(/restored/i).first()).toBeVisible();
  });

  test('6 · a school can never reach the console, and vice versa', async ({ page, request }) => {
    // A staff token is not a platform token.
    const staff = await request.post(`${API}/auth/login`, {
      data: { email: 'owner@demo.school', password: 'Password1!' },
    });
    const staffToken = (await staff.json()).token;
    const asStaff = await request.get(`${API}/platform/schools`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      failOnStatusCode: false,
    });
    expect(asStaff.status(), 'a school owner must not read the platform console').toBe(401);

    // And a platform token is not a staff token — the inverse mattered more than it looked:
    // the staff guard used to name the kinds it rejected, so a new kind was admitted by default.
    const platform = await request.post(`${API}/platform/auth/login`, { data: PLATFORM });
    const platformToken = (await platform.json()).token;
    const asPlatform = await request.get(`${API}/me`, {
      headers: { Authorization: `Bearer ${platformToken}` },
      failOnStatusCode: false,
    });
    expect(asPlatform.status(), 'a vendor token must not act inside a school').toBe(401);

    // The browser proxy is allowlisted too, so the vendor cookie cannot be pointed elsewhere.
    await signInAsPlatform(page);
    const escaped = await page.request.get('/api/platform/students', { failOnStatusCode: false });
    expect(escaped.status(), 'the platform proxy must only carry platform routes').toBe(404);
  });
});
