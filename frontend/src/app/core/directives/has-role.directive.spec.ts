import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UserRole } from '../models/finops.models';
import { RoleService } from '../services/role.service';
import { HasRoleDirective } from './has-role.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HasRoleDirective],
  template: `<button type="button" *appHasRole="'ADMIN'" id="admin-only">Delete</button>`,
})
class HostComponent {}

describe('HasRoleDirective (Web A01 UI barrier)', () => {
  const role = signal<UserRole>('VIEWER');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RoleService,
          useValue: {
            hasRole: (allowed: UserRole | readonly UserRole[]) =>
              (typeof allowed === 'string' ? [allowed] : allowed).includes(role()),
          },
        },
      ],
    });
  });

  it('removes the element from the DOM for unauthorised roles and restores it live', async () => {
    role.set('VIEWER');
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('#admin-only')).toBeNull();

    role.set('ADMIN');
    await fixture.whenStable();
    expect(root.querySelector('#admin-only')).not.toBeNull();

    role.set('VIEWER');
    await fixture.whenStable();
    expect(root.querySelector('#admin-only')).toBeNull();
  });
});
