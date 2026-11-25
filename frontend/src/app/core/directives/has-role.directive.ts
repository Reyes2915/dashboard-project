import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { UserRole } from '../models/finops.models';
import { RoleService } from '../services/role.service';

/**
 * Structural directive that removes (not hides) elements for unauthorised roles.
 * Usage: `<button *appHasRole="'ADMIN'">Approve</button>`.
 * Removing nodes from the DOM is a UX barrier; the API remains the authority (Web A01).
 */
@Directive({ selector: '[appHasRole]' })
export class HasRoleDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly roles = inject(RoleService);

  readonly appHasRole = input.required<UserRole | readonly UserRole[]>();

  private rendered = false;

  constructor() {
    effect(() => {
      const allowed = this.roles.hasRole(this.appHasRole());
      if (allowed && !this.rendered) {
        this.container.createEmbeddedView(this.template);
        this.rendered = true;
      } else if (!allowed && this.rendered) {
        this.container.clear();
        this.rendered = false;
      }
    });
  }
}
