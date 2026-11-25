import { expect, test } from '@playwright/test';
import { STORAGE_KEY, expensesTable, navigate, openApp, openAuditLog, switchRole, toasts } from './support/app';

test.describe('OWASP defences in the running app', () => {
  test('switching to VIEWER removes privileged actions and a forced mutation is blocked with 403 (A01 / API5)', async ({
    page,
  }) => {
    await openApp(page, '/expenses');
    await switchRole(page, 'ADMIN');
    await expect(page.getByRole('link', { name: 'New expense' })).toBeVisible();
    await expect(
      expensesTable(page)
        .getByRole('button', { name: /^Approve / })
        .first(),
    ).toBeVisible();

    // UI barrier: privileged controls disappear from the DOM, not just visually.
    await switchRole(page, 'VIEWER');
    await expect(page.getByRole('link', { name: 'New expense' })).toHaveCount(0);
    await expect(expensesTable(page).getByRole('button', { name: /^(Approve|Reject|Delete) / })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);

    // Route guard: deep-linking to the wizard is refused.
    await page.goto('/expenses/new');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(toasts(page)).toContainText('This area requires one of: ADMIN.');

    // Server barrier: the same DELETE sent as VIEWER (as if the button were re-enabled in DevTools).
    await navigate(page, 'Security lab');
    const probe = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'VIEWER tries to delete an expense' }) });
    await probe.getByRole('button', { name: /Run probe/ }).click();
    await expect(probe).toContainText('Blocked as expected');
    await expect(probe).toContainText('HTTP 403');

    // Security audit drawer shows the server-side 403 event.
    const drawer = await openAuditLog(page);
    const event = drawer.getByRole('listitem').filter({ hasText: 'BFLA blocked: VIEWER attempted DELETE' }).first();
    await expect(event).toBeVisible();
    await expect(event).toContainText('AUTHZ_DENIED');
    await expect(event).toContainText('Source: API gateway');
  });

  test('tampering with localStorage is detected by the SHA-256 checksum and the secure seed is restored (A08)', async ({
    page,
  }) => {
    await openApp(page, '/dashboard');
    const approvedSpend = page.getByRole('article', { name: 'Approved spend' });
    await expect(approvedSpend).toContainText('€');
    const before = await approvedSpend.locator('.kpi__value').innerText();

    // Attacker edits the persisted JSON in DevTools: approve a pending invoice and inflate an amount.
    const tampered = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      const forged = raw
        .replace('"netAmount":24500', '"netAmount":1')
        .replace(/("invoiceCode":"INV-1003"[^}]*"status":)"PENDING"/, '$1"APPROVED"');
      localStorage.setItem(key, forged);
      return forged !== raw;
    }, STORAGE_KEY);
    expect(tampered).toBe(true);

    // Next API read verifies the checksum, raises a critical alert and self-heals.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(approvedSpend.locator('.kpi__value')).toHaveText(before);

    const restored = await page.evaluate((key) => localStorage.getItem(key) ?? '', STORAGE_KEY);
    expect(restored).toContain('"netAmount":24500');
    expect(restored).toMatch(/"checksum":"[0-9a-f]{64}"/);

    const drawer = await openAuditLog(page);
    const alert = drawer.getByRole('listitem').filter({ hasText: 'INTEGRITY_VIOLATION' }).first();
    await expect(alert).toContainText('CRITICAL');
    await expect(alert).toContainText('SHA-256 verification');
  });

  test('an SSRF receipt URL is rejected before the wizard can continue (API7)', async ({ page }) => {
    await openApp(page, '/expenses');
    await switchRole(page, 'ADMIN');
    await page.getByRole('link', { name: 'New expense' }).click();

    const receipt = page.getByLabel('Receipt URL (optional)');
    for (const url of [
      'http://127.0.0.1/admin',
      'https://127.0.0.1/admin',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      await receipt.fill(url);
      await receipt.blur();
      await expect(receipt).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#receipt-error')).toContainText('Only public https:// URLs are allowed');
    }

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Form progress' }).locator('[aria-current="step"]'),
    ).toContainText('Invoice details');

    await receipt.fill('https://receipts.vendor.example.com/ok.pdf');
    await expect(receipt).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#receipt-error')).toBeEmpty();
  });
});

test.describe('Keyboard accessibility (WCAG 2.2)', () => {
  test('skip link moves focus to the main landmark', async ({ page }) => {
    await openApp(page, '/dashboard');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('confirmation modal traps focus, closes with Escape and restores focus to its opener', async ({ page }) => {
    await openApp(page, '/expenses');
    await switchRole(page, 'ADMIN');

    const deleteButton = expensesTable(page)
      .getByRole('button', { name: /^Delete / })
      .first();
    await deleteButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Delete expense?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Focus never leaves the dialog while tabbing in either direction.
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();

    // Nothing was deleted: dismissing is non-destructive.
    await expect(toasts(page)).not.toContainText('was deleted');
  });

  test('security audit drawer opens from the keyboard and Escape returns focus to its toggle', async ({ page }) => {
    await openApp(page, '/dashboard');
    const toggle = page.getByRole('button', { name: /Audit log/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('complementary', { name: 'Security audit log' });
    await expect(drawer).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('heading', { name: 'Security audit log' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('high-contrast theme toggle is announced as a pressed button and persists', async ({ page }) => {
    await openApp(page, '/dashboard');
    const toggle = page.getByRole('button', { name: 'High contrast' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
  });
});
