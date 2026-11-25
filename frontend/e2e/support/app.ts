import { Locator, Page, expect } from '@playwright/test';

/** Shared page helpers. Locators are role/label based so tests double as accessibility checks. */

export const STORAGE_KEY = 'finops.mockdb.v1';

export async function openApp(page: Page, path = '/dashboard'): Promise<void> {
  await page.goto(path);
  // The app bootstraps a least-privilege VIEWER session before rendering routes.
  await expect(page.locator('#role-identity')).toContainText('Department Viewer');
}

export async function switchRole(page: Page, role: 'ADMIN' | 'VIEWER'): Promise<void> {
  await page.getByLabel('Role').selectOption(role);
  const identity = role === 'ADMIN' ? 'Finance Admin' : 'Department Viewer';
  await expect(page.locator('#role-identity')).toContainText(identity);
  await expect(page.getByLabel('Role')).toBeEnabled();
}

export async function navigate(page: Page, name: 'Dashboard' | 'Expenses' | 'Security lab'): Promise<void> {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name }).click();
}

export function toasts(page: Page): Locator {
  return page.getByRole('region', { name: 'Notifications' });
}

export async function openAuditLog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /Audit log/ }).click();
  const drawer = page.getByRole('complementary', { name: 'Security audit log' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Unique, valid invoice code per test run (INV- + 4 digits, outside the seeded 1001-1021 range). */
export function uniqueInvoiceCode(): string {
  return `INV-${String(3000 + Math.floor(Math.random() * 6000))}`;
}

export function expensesTable(page: Page): Locator {
  return page.getByRole('table');
}
