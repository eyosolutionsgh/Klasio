import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { keepGatewayOnThisOrigin } from './support/gateway';

/**
 * Multi-tenancy and subscription isolation.
 *
 * Two schools exist side by side, and everything one does must be invisible to the other. The
 * fixtures are deliberately unalike — different admission-number formats, levels, terms, brand
 * colour and tier — so a leak shows up as a visible wrong value rather than as a subtle count.
 *
 * Requires BOTH seeds, in this order:
 *   pnpm db:seed
 *   pnpm --filter @eyo/api db:seed:second
 *
 * Re-runnable without re-seeding. The subscription tests move tenant B's tier, so each one puts
 * B back where it needs it first — see `resetTenantB`. They used to simply assume a fresh seed,
 * which meant a second run reported two failures that were about the fixture rather than about
 * the product. Tenant A's tier is asserted and never changed: that is the whole point of the
 * isolation checks, and it is why only B is ever reset.
 *
 * The seeds are still needed once, for the rich fixtures the isolation tests read — students,
 * levels, terms. A school registered from scratch has none of those, so there would be nothing
 * to prove could not leak.
 */

const SHOTS = 'e2e/screenshots/tenancy';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const API_DIR = path.resolve(__dirname, '../../api');
const MOCK_SECRET = 'mock-gateway-secret';

/** Tenant B's slug, the handle the billing-clock script works by. */
const B_SLUG = 'sunbeam-international';

/** Tenant A — the original demo school. Nothing in this file may change it. */
const A = {
  owner: 'owner@demo.school',
  school: 'Brighton Academy',
  admissionPrefix: 'BA-',
  tier: 'MEDIUM',
  term: 'Term 3',
};

/** Tenant B — provisioned by seed-second-school.ts, starts on the free tier. */
const B = {
  owner: 'owner@sunbeam.school',
  school: 'Sunbeam International School',
  admissionPrefix: 'SIS/',
  tier: 'BASIC',
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

/** The tier the API itself reports for the signed-in school, independent of any rendering. */
async function currentTier(page: Page): Promise<string> {
  const res = await page.request.get('/api/proxy/billing/plans');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).currentTier;
}

/**
 * Put the signed-in school on `tier` by paying for it, so a test that needs a starting tier does
 * not depend on an earlier test having run. Goes through subscribe + settle, the real path.
 */
async function buyTier(page: Page, tier: 'MEDIUM' | 'ADVANCED'): Promise<string> {
  const started = await page.request.post('/api/proxy/billing/subscribe', {
    data: { tier, channel: 'MOMO' },
  });
  expect(started.ok()).toBeTruthy();
  const { reference } = await started.json();
  const settled = await page.request.post(`${API}/billing/mock-settle`, {
    data: { reference, secret: MOCK_SECRET },
  });
  expect(settled.ok()).toBeTruthy();
  return reference as string;
}

/** What the database says about tenant B's subscription — for setup, never in place of a screen. */
function clock(action: 'show' | 'expire', daysAgo?: number) {
  const out = execFileSync(
    'pnpm',
    [
      'exec',
      'ts-node',
      '--transpile-only',
      'prisma/e2e-billing-clock.ts',
      B_SLUG,
      action,
      ...(daysAgo ? [String(daysAgo)] : []),
    ],
    { cwd: API_DIR, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop()!) as {
    schoolTier: string;
    subscription: { pendingTier: string | null } | null;
  };
}

/**
 * Put tenant B back on the free tier with nothing scheduled.
 *
 * Only tenant B, and only ever downward: A is the control in every one of these tests and must
 * not be touched. Uses the product's own route down — schedule the step, then let the paid
 * period run out — rather than writing a tier straight into the database, so a bug in that path
 * shows up here as a failed setup rather than being papered over.
 *
 * A no-op on a freshly seeded database, which is the common case.
 */
async function resetTenantB(page: Page) {
  const before = clock('show');
  if (before.schoolTier === 'BASIC' && !before.subscription?.pendingTier) return;

  await login(page, B.owner);
  if (before.schoolTier !== 'BASIC') {
    const res = await page.request.post('/api/proxy/billing/change-tier', {
      data: { tier: 'BASIC' },
    });
    expect(res.ok(), 'setup: an owner must be able to step their school down').toBeTruthy();
  }
  // Ends the paid period, which is what makes a scheduled change due.
  clock('expire', 30);
  await logout(page);

  // Sign-in is where the product applies anything the clock has made due.
  await login(page, B.owner);
  expect(clock('show').schoolTier, 'setup: tenant B should be back on the free tier').toBe('BASIC');
  await logout(page);
}

test.describe('multi-tenant isolation', () => {
  test('each school sees only its own students', async ({ page }) => {
    await login(page, A.owner);
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await page.waitForSelector('tbody tr');

    const aBody = (await page.locator('tbody').innerText()).trim();
    expect(aBody).toContain(A.admissionPrefix);
    // The decisive assertion: tenant B's admission numbers must not appear at all.
    expect(aBody).not.toContain(B.admissionPrefix);
    await page.screenshot({ path: `${SHOTS}/01-tenantA-students.png`, fullPage: true });

    await logout(page);

    await login(page, B.owner);
    await page.goto('/students');
    await page.waitForSelector('tbody tr');
    const bBody = (await page.locator('tbody').innerText()).trim();
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
    const aStudents = await (await page.request.get('/api/proxy/students')).json();
    const aStudentId = (aStudents.items ?? aStudents)[0].id as string;
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

test.describe('subscriptions are per-school', () => {
  test('tenant B upgrades BASIC → MEDIUM without touching tenant A', async ({ page, baseURL }) => {
    // The climb has to start at the bottom, whatever an earlier run left behind.
    await resetTenantB(page);

    // Record tenant A's billing state before anything happens.
    await login(page, A.owner);
    const aTierBefore = await currentTier(page);
    expect(aTierBefore).toBe(A.tier);
    const aInvoicesBefore = await (await page.request.get('/api/proxy/billing/invoices')).json();
    await logout(page);

    // Tenant B buys MEDIUM through the UI.
    await keepGatewayOnThisOrigin(page, baseURL);
    await login(page, B.owner);
    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible();
    await expect(page.getByText(B.school).first()).toBeVisible();
    expect(await currentTier(page)).toBe('BASIC');
    await page.screenshot({ path: `${SHOTS}/05-tenantB-billing-basic.png`, fullPage: true });

    const mediumCard = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'MEDIUM' }) });
    await mediumCard.getByRole('button', { name: /^Pay / }).click();
    await mediumCard.getByRole('button', { name: /^Continue to pay / }).click();

    // The mock gateway hands back its own checkout page. Crucially, the tier has NOT moved yet.
    await page.waitForURL('**/pay/mock/**');
    const reference = decodeURIComponent(page.url().split('/pay/mock/')[1].split('?')[0]);
    expect(reference).toMatch(/^SUB-/);
    await page.screenshot({ path: `${SHOTS}/06-tenantB-checkout.png`, fullPage: true });

    await page.goto('/settings/billing');
    expect(await currentTier(page), 'tier moved before the gateway confirmed the money').toBe(
      'BASIC',
    );

    // Settle it the way the vendor console would.
    const settled = await page.request.post(`${API}/billing/mock-settle`, {
      data: { reference, secret: MOCK_SECRET },
    });
    expect(settled.ok()).toBeTruthy();
    expect((await settled.json()).tier).toBe('MEDIUM');

    await page.goto('/settings/billing');
    expect(await currentTier(page)).toBe('MEDIUM');
    await expect(page.getByText(reference)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/07-tenantB-billing-medium.png`, fullPage: true });

    await logout(page);

    // Tenant A must be exactly as it was — same tier, and none of B's invoices visible.
    await login(page, A.owner);
    expect(await currentTier(page), 'tenant A’s tier changed when B upgraded').toBe(aTierBefore);
    const aInvoicesAfter = await (await page.request.get('/api/proxy/billing/invoices')).json();
    expect(aInvoicesAfter).toHaveLength(aInvoicesBefore.length);
    expect(JSON.stringify(aInvoicesAfter)).not.toContain(reference);
    await page.screenshot({ path: `${SHOTS}/08-tenantA-billing-unchanged.png`, fullPage: true });
  });

  test('tenant B schedules a downgrade without touching tenant A', async ({ page }) => {
    /**
     * Start from a *clean* MEDIUM, not merely from MEDIUM.
     *
     * The old guard only bought MEDIUM if the school was not already on it, so a second run
     * found the downgrade this test had already scheduled — and the plan card reads "Already
     * scheduled" rather than offering the button, which surfaced as a 45-second timeout.
     * Resetting first and paying again clears the pending change, because settling a payment
     * drops it.
     */
    await resetTenantB(page);
    await login(page, B.owner);
    await buyTier(page, 'MEDIUM');
    await page.goto('/settings/billing');
    expect(await currentTier(page)).toBe('MEDIUM');

    const basicCard = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'BASIC' }) });
    await basicCard.getByRole('button', { name: /^Move down to / }).click();
    await basicCard.getByRole('button', { name: 'Schedule it' }).click();
    await expect(page.getByRole('status').filter({ hasText: /BASIC/ }).first()).toBeVisible();

    // A downgrade is an intention, not an immediate change: the paid term keeps working.
    await page.goto('/settings/billing');
    expect(
      await currentTier(page),
      'downgrade took effect immediately — the paid period was not honoured',
    ).toBe('MEDIUM');
    await expect(page.getByText(/then moving to BASIC/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/09-tenantB-downgrade-scheduled.png`, fullPage: true });

    await logout(page);

    // Tenant A has no scheduled change and is still on its own tier.
    await login(page, A.owner);
    await page.goto('/settings/billing');
    expect(await currentTier(page)).toBe(A.tier);
    await expect(page.getByText(/then moving to/)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/10-tenantA-no-pending.png`, fullPage: true });
  });

  test('an upgrade cannot be granted without paying, and only the owner may commit', async ({
    page,
  }) => {
    // change-tier is the unpaid path. It must refuse to move a school upward, whoever asks.
    await login(page, A.owner);
    const aTierBefore = await currentTier(page);
    const unpaid = await page.request.post('/api/proxy/billing/change-tier', {
      data: { tier: 'ADVANCED' },
    });
    expect(unpaid.ok(), 'change-tier granted a free upgrade').toBeFalsy();
    expect(await currentTier(page)).toBe(aTierBefore);
    await logout(page);

    // Committing the school to a recurring bill is the proprietor's own decision.
    await login(page, 'head@sunbeam.school');
    const asHead = await page.request.post('/api/proxy/billing/subscribe', {
      data: { tier: 'ADVANCED', channel: 'MOMO' },
    });
    expect(asHead.status(), 'a non-owner was allowed to commit the school to a bill').toBe(403);
  });
});
