import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { keepGatewayOnThisOrigin } from './support/gateway';

/**
 * The paid lifecycle of one school, start to finish, with a picture at every step.
 *
 * A school signs up free, pays to move up, loses what it stopped paying for, pays again and
 * gets it back. Each of those is a claim the product makes to a bursar, and each is checked
 * here against what the sidebar actually renders — not against the tier field, which is the
 * thing under test and so cannot be its own evidence.
 *
 * Grouped rather than run as one serial file. Within a group each test inherits the tier the
 * one before it left behind, because that is what a real school's month looks like — but a
 * group that fails must not take the later claims down with it and leave them unreported. Each
 * group therefore puts the school into the tier it needs before it starts measuring.
 *
 * Needs the stack up (api :4000, web :3000) and no seed at all — it registers its own school,
 * which is the first thing it has to prove anyway. That also keeps it out of `tenancy.spec.ts`'s
 * way: both suites used to move the seeded Sunbeam school's tier, so running them together left
 * whichever went second asserting against the other's leftovers.
 */

const SHOTS = 'e2e/screenshots/subscription';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const MOCK_SECRET = 'mock-gateway-secret';
const API_DIR = path.resolve(__dirname, '../../api');

/**
 * The school this suite registers and then puts through its paces.
 *
 * The slug is what the API derives from the name, and is the handle the billing-clock script
 * needs — so if the slug rule ever changes, this constant is where the suite says so.
 */
/** EYO's own account, from `pnpm --filter @eyo/api db:seed:platform`. */
const PLATFORM = { email: 'admin@eyo.gh', password: 'Platform1!' };

const SCHOOL = {
  name: 'Akoma Preparatory School',
  slug: 'akoma-preparatory-school',
  ownerName: 'Mrs. Ama Owusu',
  owner: 'proprietor@akoma-prep.test',
  password: 'FirstDayHere1!',
};

/**
 * Sidebar entries gated behind MEDIUM entitlements. These are the visible consequence of a
 * tier — the whole reason a school pays — so they are what the assertions look at.
 */
const PAID_NAV = [
  'Admissions',
  'Timetable',
  'Dismissal',
  'Resources',
  'WhatsApp',
  'Payment Setup',
  'Reconciliation',
  'Termly Returns',
];

/** Always present, on any tier. If these vanish the test is measuring the wrong thing. */
const FREE_NAV = ['Dashboard', 'Students', 'Attendance', 'Fees'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  });
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(SCHOOL.owner);
  await page.getByRole('textbox', { name: 'Password' }).fill(SCHOOL.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');
}

/**
 * Get an invitation for this suite's school.
 *
 * Registration is vendor-initiated, so a school cannot exist until EYO says so — which means
 * every test here now starts by being the vendor for a moment. Returns an empty string if the
 * address already has an outstanding invitation or an account, in which case the registration
 * that follows will be refused for that reason rather than for a missing token.
 */
async function inviteToken(page: Page): Promise<string> {
  const signIn = await page.request.post(`${API}/platform/auth/login`, {
    data: { email: PLATFORM.email, password: PLATFORM.password },
    failOnStatusCode: false,
  });
  if (!signIn.ok()) return '';
  const { token } = await signIn.json();

  const res = await page.request.post(`${API}/platform/invitations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { schoolName: SCHOOL.name, email: SCHOOL.owner },
    failOnStatusCode: false,
  });
  if (!res.ok()) return '';
  return (await res.json()).token as string;
}

/** Wipe the school this suite owns, so a re-run starts from nothing. Touches no other tenant. */
function purge() {
  execFileSync(
    'pnpm',
    ['exec', 'ts-node', '--transpile-only', 'prisma/e2e-purge-registered-school.ts', SCHOOL.owner],
    { cwd: API_DIR, encoding: 'utf8' },
  );
}

/**
 * Sign in, registering the school first if it is not there.
 *
 * Test 1 registers it through the UI, which is the claim being made. This is for every test
 * after it: a suite where test 4 cannot run because test 1 failed reports one problem and hides
 * three, and running a single test with `-g` should still work.
 */
async function signIn(page: Page) {
  // No token means EYO would not issue one — almost always because this address already runs a
  // school, which is the normal case here: test 1 registered it and the rest just sign in.
  const token = await inviteToken(page);
  if (token) {
    const res = await page.request.post('/api/register', {
      data: {
        token,
        schoolName: SCHOOL.name,
        ownerName: SCHOOL.ownerName,
        email: SCHOOL.owner,
        password: SCHOOL.password,
      },
      failOnStatusCode: false,
    });
    expect([200, 201]).toContain(res.status());
  }
  await page.context().clearCookies();
  await login(page);
}

async function logout(page: Page) {
  await page.request.delete('/api/session');
  await page.context().clearCookies();
}

/**
 * Sign in again from scratch.
 *
 * The tier is minted into the JWT at sign-in, so a tier change is invisible to a page reload.
 * Any test asserting that features moved has to go back through the door.
 */
async function reLogin(page: Page) {
  await logout(page);
  await login(page);
}

/**
 * Open every collapsed nav group.
 *
 * The sidebar unmounts a closed group's links rather than hiding them, so "is this link on the
 * page?" otherwise answers a question about the accordion instead of about the tier. Opening
 * everything first also makes the screenshots show the whole menu, which is the evidence.
 */
async function expandNav(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  // Re-resolved on every pass: opening a group re-renders the nav, so a list of handles
  // collected up front goes stale after the first click.
  const closed = nav.locator('button[aria-expanded="false"]');
  for (let guard = 0; guard < 12 && (await closed.count()) > 0; guard++) {
    await closed.first().click();
  }
  await expect(closed).toHaveCount(0);
}

/** Which gated nav entries the signed-in user can actually reach. */
async function visibleNav(page: Page): Promise<string[]> {
  await expandNav(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const found: string[] = [];
  for (const label of PAID_NAV) {
    if (await nav.getByRole('link', { name: label, exact: true }).isVisible()) found.push(label);
  }
  return found;
}

/** What the database thinks, for the record — never used in place of what the screen shows. */
function clock(action: 'show' | 'expire', daysAgo?: number) {
  const out = execFileSync(
    'pnpm',
    [
      'exec',
      'ts-node',
      '--transpile-only',
      'prisma/e2e-billing-clock.ts',
      SCHOOL.slug,
      action,
      ...(daysAgo ? [String(daysAgo)] : []),
    ],
    { cwd: API_DIR, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop()!);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/**
 * Put the school back on the free tier the way the product intends one to get there — schedule
 * the step down, then let the paid period run out. Used to set up the "pays again" claim so it
 * still reports an answer when the lapse claim above it has failed.
 */
async function scheduleStepDown(page: Page) {
  await page.goto('/settings/billing');
  const basic = page.locator('section').filter({ hasText: /^BASIC/ });

  // Two clicks, deliberately: the first only opens the confirmation, which spells out that the
  // paid term is seen out in full. Committing a school to a smaller plan should not be one click.
  await basic.getByRole('button', { name: /^Move down to BASIC$/ }).click();
  await basic.getByRole('button', { name: 'Schedule it' }).click();

  // Scheduled, not applied — the page says so, and that is the product's position: the term is
  // already paid for, so nothing is taken away before it ends.
  await expect(
    page.getByText(/then moving to BASIC/i),
    'scheduling a step down should be acknowledged on the page',
  ).toBeVisible();
  expect(clock('show').schoolTier, 'a scheduled downgrade must not move the tier yet').toBe(
    'MEDIUM',
  );
}

/** Get the school onto BASIC however it currently stands. Setup for the renewal test. */
async function dropToBasic(page: Page) {
  if (clock('show').schoolTier === 'BASIC') return;
  await scheduleStepDown(page);
  clock('expire', 30);
  await reLogin(page);
}

/**
 * Buy a plan the way a school actually does: the plan card, the payment form, the gateway's
 * checkout, and back to the portal. Every step is a real navigation, so this is what there is
 * to watch — and what a screen recording of the run shows.
 *
 * Returns once the browser is back on the portal. The tier has not moved yet at that point: only
 * the settled callback moves it, which is the product's whole position on paying.
 */
async function payThroughCheckout(page: Page, tier: 'MEDIUM' | 'ADVANCED', baseURL?: string) {
  // The gateway redirects to the API's own configured base, which is not necessarily the port
  // this suite is driving — and may not be listening at all.
  await keepGatewayOnThisOrigin(page, baseURL);
  await page.goto('/settings/billing');
  await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible();

  const card = page.locator('section').filter({ hasText: new RegExp(`^${tier}`) });
  await card.getByRole('button', { name: new RegExp(`^Pay .* for ${tier}$`) }).click();
  await card.getByRole('button', { name: /^Continue to pay/ }).click();

  // The mock gateway stands in for Paystack/MoMo: same redirect, same callback shape.
  await page.waitForURL(/\/pay\/mock\//, { timeout: 15000 });
  await page.getByRole('button', { name: 'Approve payment' }).click();

  // Approving either sends us back to the portal or refuses on the spot. Wait for whichever
  // arrives, so a failure reports the refusal rather than a bare navigation timeout.
  const refusal = page.getByText(/could not complete|unknown payment reference/i);
  const back = /\/(pay\/return|settings\/billing)/;
  await Promise.race([
    page.waitForURL(back, { timeout: 15000 }).catch(() => undefined),
    refusal.waitFor({ timeout: 15000 }).catch(() => undefined),
  ]);
  return { refusal, back };
}

/**
 * Buy MEDIUM and have it confirmed, without going through the screens.
 *
 * Setup only, for tests whose subject is what happens *after* a payment. Still reaches `settle`
 * through the gateway callback rather than writing a tier, so the path is the production one.
 */
async function ensureMedium(page: Page) {
  if (clock('show').schoolTier === 'MEDIUM') return;
  const invoices = await (await page.request.get('/api/proxy/billing/invoices')).json();
  let reference = invoices.find(
    (i: { status: string; tier: string }) => i.status === 'PENDING' && i.tier === 'MEDIUM',
  )?.reference;
  if (!reference) {
    const started = await page.request.post('/api/proxy/billing/subscribe', {
      data: { tier: 'MEDIUM', channel: 'MOMO' },
    });
    expect(started.ok(), 'a school must be able to buy a plan').toBeTruthy();
    reference = (await started.json()).reference;
  }
  const settled = await page.request.post(`${API}/billing/mock-settle`, {
    data: { reference, secret: MOCK_SECRET },
  });
  expect(settled.ok(), 'the demo settlement hook must confirm the payment').toBeTruthy();
  await reLogin(page);
}

test.describe('registering a school', () => {
  test('1 · an owner can register a school, which starts on the free tier', async ({ page }) => {
    // The owner's email is unique across every school, so last run's account would refuse this
    // one — correctly. Clear it rather than dodge it with a random address, so the test keeps
    // proving that a plain, ordinary email works.
    purge();

    // Without an invitation there is no way in at all — the page says so and offers no form.
    await page.goto('/register');
    await expect(
      page.getByRole('heading', { name: 'Invitation needed' }),
      'registering must be impossible without an invitation from EYO',
    ).toBeVisible();
    await shot(page, '01-no-invitation');

    // So EYO issues one. This is the vendor acting, not the school.
    const token = await inviteToken(page);
    expect(token, 'the platform admin must be able to issue an invitation').not.toBe('');

    await page.goto(`/register?token=${encodeURIComponent(token)}`);
    await expect(page.getByRole('heading', { name: 'Register your school' })).toBeVisible();

    await page.getByLabel('School name').fill(SCHOOL.name);
    await page.getByLabel('Your name').fill(SCHOOL.ownerName);
    await page.getByRole('textbox', { name: 'Password' }).fill(SCHOOL.password);
    await shot(page, '01b-register-form');

    // The address is the invitation's and cannot be edited — that is what makes a forwarded
    // link useless to anyone else.
    await expect(page.getByLabel('Email address')).toHaveValue(SCHOOL.owner);
    await expect(page.getByLabel('Email address')).toHaveAttribute('readonly', '');

    await page.getByRole('button', { name: 'Create school' }).click();

    // Registration ends signed in — a new school that had to go and log in separately would be
    // a worse first thirty seconds than it needs to be.
    await page.waitForURL('**/settings/school', { timeout: 20000 });
    await expandNav(page);
    await shot(page, '01c-registered');

    await expect(
      page.getByRole('banner').getByText(SCHOOL.name),
      'the new owner should be inside their own school',
    ).toBeVisible();
    await expect(
      page.getByRole('banner').getByText('BASIC', { exact: true }),
      'a school nobody has paid for must start on the free tier',
    ).toBeVisible();
    expect(await visibleNav(page), 'a brand new school must not be given paid features').toEqual(
      [],
    );
  });
});

test.describe('buying a plan', () => {
  test('2 · a free school is shown only what the free tier includes', async ({ page }) => {
    await signIn(page);
    await expandNav(page);
    await shot(page, '02-basic-sidebar');

    const state = clock('show');
    expect(state.schoolTier, 'fixture must start on BASIC — re-run db:seed:second').toBe('BASIC');

    for (const label of FREE_NAV) {
      await expect(
        page
          .getByRole('navigation', { name: 'Main' })
          .getByRole('link', { name: label, exact: true }),
      ).toBeVisible();
    }
    expect(await visibleNav(page), 'a BASIC school must not be shown paid features').toEqual([]);
  });

  test('3 · the owner pays for MEDIUM through the checkout the product hands them', async ({
    page,
    baseURL,
  }) => {
    await signIn(page);
    const { refusal, back } = await payThroughCheckout(page, 'MEDIUM', baseURL);
    await shot(page, '06-after-payment');

    await expect(
      refusal,
      'the checkout the product hands a school must be able to take its subscription payment',
    ).toHaveCount(0);
    await expect(page).toHaveURL(back);
  });

  test('4 · once the money is confirmed, the paid features appear', async ({ page }) => {
    await signIn(page);

    // Confirms whatever the checkout above left pending, or buys it outright if that checkout
    // never got far enough to leave anything.
    await ensureMedium(page);
    await expandNav(page);
    await shot(page, '07-medium-sidebar');

    expect(clock('show').schoolTier).toBe('MEDIUM');
    expect(await visibleNav(page), 'paying for MEDIUM must unlock the MEDIUM features').toEqual(
      PAID_NAV,
    );

    await page.goto('/settings/billing');
    await shot(page, '08-billing-on-medium');
    await expect(page.getByText('MEDIUM').first()).toBeVisible();
  });
});

test.describe('stepping down on purpose', () => {
  test('5 · the owner schedules a step down, and keeps everything until the term ends', async ({
    page,
  }) => {
    await signIn(page);
    await ensureMedium(page);

    // The whole journey through the screens: the plan card, the confirmation, the banner.
    await scheduleStepDown(page);
    await shot(page, '08b-downgrade-scheduled');

    // Nothing is taken away before the paid period ends — the term has been paid for.
    await reLogin(page);
    expect(
      await visibleNav(page),
      'a scheduled step down must not remove anything before the term ends',
    ).toEqual(PAID_NAV);

    // Now run the clock out, which is what applies it.
    clock('expire', 30);
    await reLogin(page);
    await expandNav(page);
    await shot(page, '08c-downgrade-applied');

    expect(
      await visibleNav(page),
      'once the paid term is over, a scheduled step down takes effect',
    ).toEqual([]);
    expect(clock('show').schoolTier).toBe('BASIC');
  });
});

test.describe('losing a plan', () => {
  test('6 · when the paid period lapses, the paid features go away again', async ({ page }) => {
    await signIn(page);
    await ensureMedium(page);

    // Well past the 14-day grace the pricing rules allow, so this is an unambiguous lapse and
    // not a renewal that is merely a few days late.
    const expired = clock('expire', 30);
    expect(expired.expired).toBe(true);

    // Back through the door: the tier is read at sign-in, and sign-in is where the product
    // applies anything the billing clock has made due.
    await reLogin(page);
    await expandNav(page);
    await shot(page, '09-after-lapse-sidebar');

    await page.goto('/settings/billing');
    await shot(page, '10-after-lapse-billing');
    await page.goto('/dashboard');

    expect(
      await visibleNav(page),
      'a school whose subscription lapsed must fall back to the free tier',
    ).toEqual([]);
    expect(
      clock('show').schoolTier,
      'a lapsed subscription must not leave the school on MEDIUM',
    ).toBe('BASIC');
  });
});

test.describe('regaining a plan', () => {
  test('7 · paying again puts the features straight back', async ({ page, baseURL }) => {
    await signIn(page);

    // Start from a school that genuinely has nothing, however it got there.
    await dropToBasic(page);
    expect(await visibleNav(page), 'setup: the school must be on the free tier first').toEqual([]);

    // Through the screens, not the API: a school coming back after a lapse is exactly the
    // journey most worth being able to watch end to end.
    const { refusal, back } = await payThroughCheckout(page, 'MEDIUM', baseURL);
    await expect(refusal, 'a lapsed school must be able to buy its plan again').toHaveCount(0);
    await expect(page).toHaveURL(back);
    await shot(page, '10b-renewal-confirmed');

    await reLogin(page);
    await expandNav(page);
    await shot(page, '11-restored-sidebar');

    expect(
      await visibleNav(page),
      'renewing must restore every paid feature, with no manual step',
    ).toEqual(PAID_NAV);

    await page.goto('/settings/billing');
    await shot(page, '12-restored-billing');
  });
});
