import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';
import { USER_ROLES, UserRole } from './core/models/finops.models';
import { RoleService } from './core/services/role.service';
import { SecurityAuditService } from './core/services/security-audit.service';
import { SecurityAuditDrawerComponent } from './shared/components/security-audit-drawer/security-audit-drawer.component';
import { ToastContainerComponent } from './shared/components/toast-container/toast-container.component';
import { controlValue } from './shared/utils/dom-events';

type Theme = 'light' | 'high-contrast';
const THEME_KEY = 'finops.theme'; // UI preference only: never credentials or business data.

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastContainerComponent, SecurityAuditDrawerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly roles = inject(RoleService);
  protected readonly audit = inject(SecurityAuditService);
  protected readonly availableRoles = USER_ROLES;

  protected readonly theme = signal<Theme>(readStoredTheme());
  protected readonly auditOpen = signal(false);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly auditToggle = viewChild.required<ElementRef<HTMLButtonElement>>('auditToggle');

  constructor() {
    applyTheme(this.theme());

    // Move focus to <main> after client-side navigation so screen readers announce the new page.
    inject(Router)
      .events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.main().nativeElement.focus({ preventScroll: true }));
  }

  protected onRoleChange(event: Event): void {
    const value = controlValue(event);
    const role = USER_ROLES.find((r): r is UserRole => r === value);
    if (role !== undefined) this.roles.switchRole(role);
  }

  protected toggleTheme(): void {
    const next: Theme = this.theme() === 'light' ? 'high-contrast' : 'light';
    this.theme.set(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable: preference simply is not remembered */
    }
  }

  protected toggleAudit(): void {
    this.auditOpen.update((open) => !open);
  }

  protected closeAudit(): void {
    this.auditOpen.set(false);
    this.auditToggle().nativeElement.focus();
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'high-contrast' ? 'high-contrast' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}
