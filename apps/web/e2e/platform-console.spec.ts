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

test.describe('the platform owner', () => {
  test('1 · signs in to a console that lists every school', async ({ page }) => {
    await signInAsPlatform(page);
    await shot(page, '01-schools');

    // Cross-tenant by design: this is the only place in the product where two schools appear on
    // one screen, which is exactly why everything else is fenced.
    await expect(page.getByRole('cell', { name: /Brighton Academy/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Sunbeam International/ })).toBeVisible();
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
    const school = await page.context().browser()!.newContext();
    const tab = await school.newPage();
    await tab.goto(url);
    await tab.getByLabel('Your name').fill('Mr. Kofi Boateng');
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Create school' }).click();
    await tab.waitForURL('**/settings/school', { timeout: 20000 });
    await shot(tab, '03-school-registered');
    await tab.close();
    await school.close();

    await page.reload();
    await page.getByRole('button', { name: 'invitations' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(INVITED.school) }).getByText('ACCEPTED'),
      'the invitation should be spent once the school has used it',
    ).toBeVisible();
  });

  test('3 · suspends a school, which can no longer sign in', async ({ page }) => {
    await signInAsPlatform(page);

    const row = page.getByRole('row', { name: new RegExp(INVITED.school) });
    page.once('dialog', (d) => d.accept('Subscription unpaid for two terms'));
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(
      page
        .getByRole('row', { name: new RegExp(INVITED.school) })
        .getByText('Suspended', { exact: true }),
    ).toBeVisible();
    await shot(page, '04-suspended');

    // The school is turned away, and told why rather than left guessing at a password.
    const school = await page.context().browser()!.newContext();
    const tab = await school.newPage();
    await tab.goto('/login');
    await tab.getByLabel('Email address').fill(INVITED.owner);
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Log in' }).click();
    await expect(tab).toHaveURL(/\/login/);
    await shot(tab, '05-suspended-school-login');
    await tab.close();
    await school.close();
  });

  test('4 · writes to a school, and restores it', async ({ page }) => {
    await signInAsPlatform(page);

    const row = page.getByRole('row', { name: new RegExp(INVITED.school) });
    await row.getByRole('button', { name: 'Contact' }).click();
    await page.getByPlaceholder('Subject').fill('Payment overdue');
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
    const school = await page.context().browser()!.newContext();
    const tab = await school.newPage();
    await tab.goto('/login');
    await tab.getByLabel('Email address').fill(INVITED.owner);
    await tab.getByRole('textbox', { name: 'Password' }).fill(INVITED.password);
    await tab.getByRole('button', { name: 'Log in' }).click();
    await tab.waitForURL('**/dashboard');
    await expect(tab.getByText('Message from EYO')).toBeVisible();
    await expect(tab.getByText('Payment overdue')).toBeVisible();
    await shot(tab, '08-school-sees-notice');
    await tab.close();
    await school.close();
  });

  test('5 · opens one school in full, and shows what was done to it', async ({ page }) => {
    await signInAsPlatform(page);

    await page.getByRole('link', { name: INVITED.school }).click();
    await page.waitForURL(/\/platform\/schools\/[^/]+$/);
    await expect(page.getByRole('heading', { name: INVITED.school })).toBeVisible();

    // Who runs it, and what they are worth — the two questions a vendor opens a school for.
    await expect(page.getByText(INVITED.owner)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who runs it' })).toBeVisible();

    // The history is the point: a suspension nobody can review later is not accountable.
    await expect(page.getByRole('heading', { name: 'What EYO has said' })).toBeVisible();
    await expect(page.getByText('Payment overdue')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'What EYO has done' })).toBeVisible();
    await expect(page.getByText('Suspended the school')).toBeVisible();
    await expect(page.getByText('Restored access')).toBeVisible();
    await expect(page.getByText('Subscription unpaid for two terms')).toBeVisible();
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
