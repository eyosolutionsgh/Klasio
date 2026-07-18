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
  await page.getByLabel('Password').fill('Password1!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('EYO SMS portal — end-to-end', () => {
  test('login page renders and rejects bad credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });

    await page.getByLabel('Email address').fill('bursar@demo.school');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email or password is not right')).toBeVisible();
  });

  test('dashboard shows term stats after login', async ({ page }) => {
    await login(page, 'bursar@demo.school');
    await expect(page.getByText('Fees position')).toBeVisible();
    await expect(page.getByText('Students enrolled')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-dashboard.png`, fullPage: true });
  });

  test('students list, filter and detail with ledger', async ({ page }) => {
    await login(page, 'bursar@demo.school');
    await page.getByRole('link', { name: 'Students' }).click();
    await page.waitForURL('**/students');
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-students.png`, fullPage: true });

    // filter to JHS 2 and open first student
    await page.getByRole('link', { name: /JHS 2 ·/ }).click();
    await page.waitForURL('**/students?classId=*');
    const firstStudent = page.locator('tbody tr td a').first();
    const name = await firstStudent.textContent();
    await firstStudent.click();
    await expect(page.getByRole('heading', { name: name ?? '' })).toBeVisible();
    await expect(page.getByText('Fee ledger')).toBeVisible();
    await expect(page.getByText('Guardians')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-student-detail.png`, fullPage: true });
  });

  test('teacher marks attendance for a class', async ({ page }) => {
    await login(page, 'teacher@demo.school');
    await page.getByRole('link', { name: 'Attendance' }).click();
    await page.waitForURL('**/attendance');
    await page.waitForSelector('li:has-text("BA-")');
    await page.getByRole('button', { name: 'All present' }).click();
    // mark the first child late for realism
    await page.locator('[role="radiogroup"]').first().getByRole('radio', { name: 'Late' }).click();
    await page.screenshot({ path: `${SHOTS}/05-attendance.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save register' }).click();
    await expect(page.getByRole('status')).toContainText('Register saved');
  });

  test('teacher edits a score and saves', async ({ page }) => {
    await login(page, 'teacher@demo.school');
    await page.getByRole('link', { name: 'Marks Entry' }).click();
    await page.waitForURL('**/marks');
    await page.waitForSelector('tbody tr');
    const firstInput = page.locator('tbody input').first();
    const current = await firstInput.inputValue();
    await firstInput.fill(current === '18' ? '17' : '18');
    await page.screenshot({ path: `${SHOTS}/06-marks-entry.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save scores' }).click();
    await expect(page.getByRole('status')).toContainText('Scores saved');
  });

  test('head generates terminal reports and views a GES report card', async ({ page }) => {
    await login(page, 'head@demo.school');
    await page.getByRole('link', { name: 'Terminal Reports' }).click();
    await page.waitForURL('**/reports');
    // pick JHS 2 (has full scores) and wait for the class switch to take effect
    const classSelect = page.getByLabel('Class');
    await classSelect.selectOption({ label: 'JHS 2' });
    const jhs2Id = await classSelect.inputValue();
    await page.waitForResponse((r) => r.url().includes(`/assessment/reports?classId=${jhs2Id}`));
    await page.getByRole('button', { name: 'Generate reports' }).click();
    await expect(page.getByText(/Generated \d+ reports?/)).toBeVisible({ timeout: 20_000 });
    await page.waitForSelector('tbody tr');
    await page.screenshot({ path: `${SHOTS}/07-reports-list.png`, fullPage: true });

    await page.getByRole('link', { name: 'View report card →' }).first().click();
    await expect(page.getByText(/Terminal Report — Term/)).toBeVisible();
    await expect(page.getByText('Position in Class:')).toBeVisible();
    await expect(page.getByText('Next Term Begins:')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/08-report-card.png`, fullPage: true });
  });

  test('bursar records a payment against a defaulter', async ({ page }) => {
    await login(page, 'bursar@demo.school');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Fees' })
      .click();
    await page.waitForURL('**/fees');
    await expect(page.getByRole('heading', { name: 'Defaulters' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/09-fees.png`, fullPage: true });

    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Amount (GHS)').fill('100');
    await page.getByRole('button', { name: 'Mobile Money' }).click();
    await page.screenshot({ path: `${SHOTS}/10-payment-dialog.png` });
    await page.getByRole('button', { name: 'Record & issue receipt' }).click();
    await expect(page.getByRole('status')).toContainText('receipt RCP-');
  });

  test('head posts an announcement', async ({ page }) => {
    await login(page, 'head@demo.school');
    await page.getByRole('link', { name: 'Announcements' }).click();
    await page.waitForURL('**/announcements');
    await page.getByLabel('Title').fill('Speech and Prize-Giving Day');
    await page
      .getByLabel('Message')
      .fill(
        'Our annual Speech Day holds on 15 August at 9am on the school park. All guardians are warmly invited.',
      );
    await page.getByRole('button', { name: 'Post notice' }).click();
    await expect(
      page.getByRole('heading', { name: 'Speech and Prize-Giving Day' }).first(),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/11-announcements.png`, fullPage: true });
  });

  test('role gating: teacher cannot record payments (API 403)', async ({ page }) => {
    await login(page, 'teacher@demo.school');
    const res = await page.request.post('/api/proxy/fees/payments', {
      data: { studentId: 'x', amount: 10, method: 'CASH' },
    });
    expect(res.status()).toBe(403);
  });
});
