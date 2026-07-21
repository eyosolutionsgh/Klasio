import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';

// Freeze entrance animations so full-page screenshots are stable and complete.
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
  // Scoped to the textbox: the field's "Show password" toggle also matches getByLabel('Password').
  await page.getByRole('textbox', { name: 'Password' }).fill('Password1!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/dashboard');
}

/**
 * Reach a portal page by URL rather than by clicking the sidebar.
 *
 * The sidebar groups its links into collapsible sections seeded open from the current page, so a
 * link like "Announcements" is not in the DOM until its section is expanded. Navigating directly
 * keeps each test about the page under test instead of the nav chrome around it.
 */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(`**${path}`);
}

/**
 * Choose an option in a `Combobox` — the searchable single-select that replaced the plain
 * `<select>` and the class chip-links.
 *
 * It is a text input owning a listbox portalled to `<body>`, so there is no `selectOption` to
 * call: focus opens it, typing filters it, and the option is a `role="option"` row. The row's
 * accessible name carries a hint ("JHS 2 12 students"), hence the anchored regex rather than an
 * exact match.
 */
async function pickCombobox(page: Page, label: string, option: string) {
  const field = page.getByRole('combobox', { name: label });
  await field.click();
  await field.fill(option);
  await page
    .getByRole('listbox', { name: label })
    .getByRole('option', { name: new RegExp(`^${option}\\b`) })
    .first()
    .click();
}

test.describe('EYO SMS portal — end-to-end', () => {
  test('login page renders and rejects bad credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });

    /**
     * A throwaway address, not a demo account.
     *
     * Wrong passwords now count towards a lockout, and they count against the address whether or
     * not it has an account. Failing `klasio-bursar@mailinator.com` here would spend one of that account's
     * five attempts on every run — and the tests below sign in as the bursar, so a handful of
     * runs inside the window would start failing them with a 429 that reads, from the browser,
     * exactly like a broken login page.
     */
    await page.getByLabel('Email address').fill('klasio-not-a-real-account@mailinator.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('That email or password is not right')).toBeVisible();
  });

  test('dashboard shows term stats after login', async ({ page }) => {
    await login(page, 'klasio-bursar@mailinator.com');
    await expect(page.getByText('Fees position')).toBeVisible();
    await expect(page.getByText('Students enrolled')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-dashboard.png`, fullPage: true });
  });

  test('students list, filter and detail with ledger', async ({ page }) => {
    await login(page, 'klasio-bursar@mailinator.com');
    await visit(page, '/students');
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-students.png`, fullPage: true });

    // filter to JHS 2 and open first student
    await pickCombobox(page, 'Class', 'JHS 2');
    await page.waitForURL('**/students?classId=*');
    const firstStudent = page.locator('tbody tr td a').first();
    const name = await firstStudent.textContent();
    await firstStudent.click();
    await expect(page.getByRole('heading', { name: name ?? '' })).toBeVisible();
    // Headings, not free text: both phrases also appear in explanatory copy elsewhere on the
    // page, and a bare getByText matches the prose as readily as the section it names.
    await expect(page.getByRole('heading', { name: 'Fee ledger' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Guardians' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-student-detail.png`, fullPage: true });
  });

  test('teacher marks attendance for a class', async ({ page }) => {
    await login(page, 'klasio-teacher@mailinator.com');
    await visit(page, '/attendance');
    await page.waitForSelector('li:has-text("BA-")');
    await page.getByRole('button', { name: 'All present' }).click();
    // mark the first child late for realism
    await page.locator('[role="radiogroup"]').first().getByRole('radio', { name: 'Late' }).click();
    await page.screenshot({ path: `${SHOTS}/05-attendance.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save register' }).click();
    /*
      The button carries the outcome now — `Save register → Saving… → Saved!` — and the note
      beside it says where the register went rather than repeating that it saved. Asserting on a
      bare getByRole('status') is ambiguous besides: every shared Button publishes its own live
      region, so any page with two of them resolves to two.
    */
    await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible();
    await expect(
      page.getByText(/Guardians of absent children are texted|Held on this device/),
    ).toBeVisible();
  });

  test('teacher edits a score and saves', async ({ page }) => {
    await login(page, 'klasio-teacher@mailinator.com');
    await visit(page, '/marks');
    await page.waitForSelector('tbody tr');
    const firstInput = page.locator('tbody input').first();
    const current = await firstInput.inputValue();
    await firstInput.fill(current === '18' ? '17' : '18');
    await page.screenshot({ path: `${SHOTS}/06-marks-entry.png`, fullPage: true });
    // Marks entry autosaves on a debounce now — there is no "Save scores" button to press, and
    // racing the debounce to click "Save now" would only be flaky.
    await expect(page.getByText(/Scores saved|Saved/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('head generates terminal reports and views a GES terminal report', async ({ page }) => {
    await login(page, 'klasio-head@mailinator.com');
    await visit(page, '/reports');
    /*
      Pick JHS 2 (it has full scores) and wait for the class switch to land.

      The signal is the URL, not a response: this page is a server component, so choosing a class
      pushes `?classId=` and the data is fetched on the server. Waiting for a browser request to
      /assessment/reports waits for something that will never happen.
    */
    await pickCombobox(page, 'Class', 'JHS 2');
    await page.waitForURL('**/reports?*classId=*');
    await page.getByRole('button', { name: 'Generate reports' }).click();
    /*
      The outcome is on the button now — `Generate reports → Generating… → Generated!` — since the
      shared action labels landed. There is no longer a "Generated N reports" line to look for.
    */
    await expect(page.getByRole('button', { name: 'Generated!' })).toBeVisible({ timeout: 20_000 });
    await page.waitForSelector('table tbody tr');
    await page.screenshot({ path: `${SHOTS}/07-reports-list.png`, fullPage: true });

    await page.getByRole('link', { name: 'View terminal report →' }).first().click();
    await expect(page.getByText(/Terminal Report — Term/)).toBeVisible();
    await expect(page.getByText('Position in Class:')).toBeVisible();
    await expect(page.getByText('Next Term Begins:')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/08-report-card.png`, fullPage: true });
  });

  test('bursar records a payment against a defaulter', async ({ page }) => {
    await login(page, 'klasio-bursar@mailinator.com');
    await visit(page, '/fees');
    await expect(page.getByRole('heading', { name: 'Defaulters' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/09-fees.png`, fullPage: true });

    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Amount (GHS)').fill('100');
    /*
      `force`, because ChoiceCards deliberately keeps the real <input type="radio"> `sr-only` —
      present for the accessibility tree and the keyboard, but visually covered by its own label,
      which intercepts the click. Checking the input is what the label would have done anyway.
    */
    await page.getByRole('radio', { name: 'Mobile Money' }).check({ force: true });
    await page.screenshot({ path: `${SHOTS}/10-payment-dialog.png` });
    await page.getByRole('button', { name: 'Record & issue receipt' }).click();
    // Scoped by its text: every shared Button on the table publishes a live region of its own, so
    // a bare getByRole('status') matches dozens. The toast is the one carrying the receipt number.
    await expect(page.getByText(/Payment recorded — receipt RCP-/)).toBeVisible();
  });

  /**
   * Announcements is a broadcast composer now: one message, several channels. Only the notice
   * board is exercised here — SMS spends real credits and social posts publicly, neither of which
   * an automated run should do to a school's account.
   */
  test('head sends a broadcast to the notice board', async ({ page }) => {
    await login(page, 'klasio-head@mailinator.com');
    await visit(page, '/announcements');
    await page.getByLabel('Title').fill('Speech and Prize-Giving Day');
    await page
      .getByLabel('Message')
      .fill(
        'Our annual Speech Day holds on 15 August at 9am on the school park. All guardians are warmly invited.',
      );
    // "Notice board" is the only channel ticked by default; assert that rather than assume it.
    await expect(page.getByRole('checkbox', { name: /Notice board/ })).toBeChecked();
    await page.getByRole('button', { name: 'Send' }).click();

    // The composer reports per channel, because channels genuinely succeed independently.
    await expect(page.getByText('Posted to the notice board')).toBeVisible();
    // And the message joins the history table below.
    await expect(page.getByText('Speech and Prize-Giving Day').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/11-announcements.png`, fullPage: true });
  });

  test('role gating: teacher cannot record payments (API 403)', async ({ page }) => {
    await login(page, 'klasio-teacher@mailinator.com');
    const res = await page.request.post('/api/proxy/fees/payments', {
      data: { studentId: 'x', amount: 10, method: 'CASH' },
    });
    expect(res.status()).toBe(403);
  });
});
