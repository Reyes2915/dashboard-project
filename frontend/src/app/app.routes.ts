import { Routes } from '@angular/router';
import { roleGuard } from './core/guards/role.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'Dashboard',
    loadComponent: () => import('./features/dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent),
  },
  {
    path: 'expenses',
    title: 'Expenses',
    loadComponent: () => import('./features/expenses/expenses-page.component').then((m) => m.ExpensesPageComponent),
  },
  {
    path: 'expenses/new',
    title: 'New expense',
    canActivate: [roleGuard('ADMIN')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/expense-form/expense-wizard.component').then((m) => m.ExpenseWizardComponent),
  },
  {
    path: 'security-lab',
    title: 'Security lab',
    loadComponent: () => import('./features/security-lab/security-lab.component').then((m) => m.SecurityLabComponent),
  },
  {
    path: '**',
    title: 'Page not found',
    loadComponent: () => import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
