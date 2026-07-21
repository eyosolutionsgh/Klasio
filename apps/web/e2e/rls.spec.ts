import { expect, test, type Page } from '@playwright/test';

/**
 * Row-level security is live — the policies apply, not merely exist.
 *
 * This file used to be about multi-tenancy. The product is one school per server now, so two
 * schools side by side is not a scenario production can reach, and a reader is right to ask why
 * it survives.
 *
 * It survives because RLS is still switched on, and this is the only thing that proves it does
 * anything. That is not hypothetical: docker-compose shipped for months setting only
 * DATABASE_URL, so the API connected as the table owner and every policy was silently inert on
 * every deployed box. Reading one school's data with another school's session is exactly the
 * shape of check that catches that. Code review had not.
 *
 * So read these assertions as "the database refuses what a query forgot to filter", not as
 * "schools are isolated from each other". The fixtures are deliberately unalike — different
 * admission-number formats, levels and terms — so a leak shows up as a visibly wrong value
 * rather than as a subtle count.
 *
 * Requires BOTH seeds, in this order:
 *   pnpm db:seed
 *   pnpm --filter @eyo/api db:seed:second
 */

const SHOTS = 'e2e/screenshots/tenancy';

/** School A — the original demo school. Nothing in this file may change it. */
const A = {
  owner: 'klasio-owner@mailinator.com',
  school: 'Brighton Academy',
  admissionPrefix: 'BA-',
  term: 'Term 3',
};

/** School B — provisioned by seed-second-school.ts. */
const B = {
  owner: 'klasio-sunbeam-owner@mailinator.com',
  school: 'Sunbeam International School',
  admissionPrefix: 'SIS/',
  term: 'Trinity Term',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  });
});

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('Password1!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');
}

async function logout(page: Page) {
  await page.request.delete('/api/session');
  await page.context().clearCookies();
}

test.describe('row-level security', () => {
  test('each school sees only its own students', async ({ page }) => {
    await login(page, A.owner);
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await page.waitForSelector('tbody tr');

    const aBody = (await page.locator('table tbody').first().innerText()).trim();
    expect(aBody).toContain(A.admissionPrefix);
    // The decisive assertion: tenant B's admission numbers must not appear at all.
    expect(aBody).not.toContain(B.admissionPrefix);
    await page.screenshot({ path: `${SHOTS}/01-tenantA-students.png`, fullPage: true });

    await logout(page);

    await login(page, B.owner);
    await page.goto('/students');
    await page.waitForSelector('tbody tr');
    const bBody = (await page.locator('table tbody').first().innerText()).trim();
    expect(bBody).toContain(B.admissionPrefix);
    expect(bBody).not.toContain(A.admissionPrefix);
    await page.screenshot({ path: `${SHOTS}/02-tenantB-students.png`, fullPage: true });
  });

  test('school identity, levels and terms do not bleed across tenants', async ({ page }) => {
    await login(page, A.owner);
    await page.goto('/settings/school');
    const aSettings = await page.locator('body').innerText();
    expect(aSettings).toContain(A.school);
    expect(aSettings).not.toContain(B.school);
    expect(aSettings).toContain(A.term);
    expect(aSettings).not.toContain(B.term);
    await page.screenshot({ path: `${SHOTS}/03-tenantA-school.png`, fullPage: true });

    await logout(page);

    await login(page, B.owner);
    await page.goto('/settings/school');
    const bSettings = await page.locator('body').innerText();
    expect(bSettings).toContain(B.school);
    expect(bSettings).not.toContain(A.school);
    expect(bSettings).toContain(B.term);
    expect(bSettings).not.toContain(A.term);
    await page.screenshot({ path: `${SHOTS}/04-tenantB-school.png`, fullPage: true });
  });

  test('a signed-in tenant cannot read another tenant’s records by id', async ({ page }) => {
    // Collect real tenant-A ids while signed in as tenant A.
    await login(page, A.owner);
    // Lists return a `Page<T>` envelope — `{ rows, total, page, perPage, pageCount }`. This read
    // `items`, which has never been a field on it, so it silently indexed the envelope itself.
    const aStudents = await (await page.request.get('/api/proxy/students')).json();
    const aStudentId = aStudents.rows[0].id as string;
    expect(aStudentId).toBeTruthy();

    await logout(page);

    // Now ask for them as tenant B. Anything other than a refusal is a tenancy breach.
    await login(page, B.owner);
    const leaked = await page.request.get(`/api/proxy/students/${aStudentId}`);
    expect(
      leaked.ok(),
      `tenant B read tenant A's student ${aStudentId} — status ${leaked.status()}`,
    ).toBeFalsy();
    expect([403, 404]).toContain(leaked.status());

    const ledger = await page.request.get(`/api/proxy/fees/students/${aStudentId}/ledger`);
    expect(ledger.ok(), 'tenant B read tenant A’s fee ledger').toBeFalsy();
  });
});
