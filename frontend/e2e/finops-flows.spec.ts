import { expect, test } from '@playwright/test';
import { expensesTable, navigate, openApp, switchRole, toasts, uniqueInvoiceCode } from './support/app';

test.describe('Core business flows', () => {
  test('ADMIN submits an expense through the 3-step wizard, finds it via reactive search and approves it', async ({
    page,
  }) => {
    const invoiceCode = uniqueInvoiceCode();
    const title = `E2E observability seats ${invoiceCode}`;

    await openApp(page, '/expenses');
    await switchRole(page, 'ADMIN');

    // ---------------------------------------------------------------- Step 1: invoice details
    await page.getByRole('link', { name: 'New expense' }).click();
    await expect(page).toHaveURL(/\/expenses\/new$/);
    await expect(page).toHaveTitle('New expense · FinOps Enterprise');

    const progress = page.getByRole('navigation', { name: 'Form progress' });
    await expect(progress.locator('[aria-current="step"]')).toContainText('Invoice details');

    await page.getByLabel('Title *').fill(title);
    await page.getByLabel('Department *').selectOption({ label: 'Engineering' });
    await page.getByLabel('Category *').selectOption({ label: 'Software' });

    // Async validator: an already registered invoice code is rejected after the debounced API check.
    const invoice = page.getByLabel('Invoice code *');
    await invoice.fill('INV-1001');
    await invoice.blur();
    await expect(page.locator('#invoice-error')).toHaveText('This invoice code is already registered.');
    await expect(invoice).toHaveAttribute('aria-invalid', 'true');

    await invoice.fill(invoiceCode);
    await expect(page.locator('#invoice-hint')).toContainText('Checking availability');
    await expect(page.locator('#invoice-hint')).toContainText('Available');
    await expect(invoice).toHaveAttribute('aria-invalid', 'false');

    await page.getByLabel('Receipt URL (optional)').fill('https://receipts.vendor.example.com/inv.pdf');
    await page.getByRole('button', { name: 'Continue' }).click();

    // ---------------------------------------------------------------- Step 2: amounts (live VAT)
    await expect(progress.locator('[aria-current="step"]')).toContainText('Amounts');
    await expect(page.getByRole('heading', { name: /Step 2 of 3/ })).toBeFocused();

    await page.getByLabel('Net amount (EUR) *').fill('1000');
    await page.getByLabel('VAT rate *').selectOption({ label: '21%' });
    const totals = page.locator('#vat-summary');
    await expect(totals).toContainText('€210.00');
    await expect(totals).toContainText('€1,210.00');

    await page.getByLabel('Business justification *').fill('Annual observability licences for the platform team.');
    await page.getByRole('button', { name: 'Continue' }).click();

    // ---------------------------------------------------------------- Step 3: review & submit
    await expect(progress.locator('[aria-current="step"]')).toContainText('Review');
    const review = page.locator('dl.review');
    await expect(review).toContainText(title);
    await expect(review).toContainText(invoiceCode);
    await expect(review).toContainText('€1,210.00');

    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(toasts(page)).toContainText(`Expense ${invoiceCode} submitted for approval.`);
    await expect(page).toHaveURL(/\/expenses$/);

    // ---------------------------------------------------------------- Reactive search
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill(invoiceCode);
    await expect(page.getByText('Showing 1–1 of 1 expenses.')).toBeVisible();
    const row = expensesTable(page).getByRole('row').filter({ hasText: invoiceCode });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Pending');
    await expect(row).toContainText('€1,210.00');

    // ---------------------------------------------------------------- Approval (confirmation modal)
    await row.getByRole('button', { name: `Approve ${title}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve expense?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Decisions are final');
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(toasts(page)).toContainText(`"${title}" was approved.`);
    await expect(row).toContainText('Approved');
    // Finite state machine: no further decisions (or deletion) are offered on a terminal record.
    await expect(row.getByRole('button')).toHaveCount(0);
  });

  test('search is debounced and narrows results server-side', async ({ page }) => {
    await openApp(page, '/expenses');
    await expect(page.getByText(/Showing 1–10 of \d+ expenses\./)).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search' }).pressSequentially('github', { delay: 40 });
    await expect(page.getByText('Showing 1–1 of 1 expenses.')).toBeVisible();
    await expect(expensesTable(page).getByRole('row').filter({ hasText: 'GitHub Enterprise renewal' })).toHaveCount(1);

    await page.getByLabel('Status').selectOption({ label: 'Approved' });
    await expect(page.getByText('No expenses match the current filters.').first()).toBeVisible();
  });

  test('sorting exposes aria-sort and the dashboard renders accessible charts', async ({ page }) => {
    await openApp(page, '/expenses');
    const totalHeader = page.getByRole('columnheader', { name: /Total/ });
    await expect(totalHeader).toHaveAttribute('aria-sort', 'none');
    await totalHeader.getByRole('button').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');
    await totalHeader.getByRole('button').click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');

    await navigate(page, 'Dashboard');
    await expect(page.getByRole('heading', { name: 'Budget overview', level: 1 })).toBeVisible();
    const chart = page.getByRole('group', { name: 'Budget utilisation by department' });
    await expect(chart).toBeVisible();

    // Keyboard navigation through bars (roving tabindex + live detail text).
    await chart.getByRole('listitem').first().focus();
    await expect(page.getByText(/^Engineering: .* approved and .* pending of .* budget/)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText(/^Marketing: .* approved and .* pending of .* budget/)).toBeVisible();
  });
});
