import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="page card" aria-labelledby="nf-title">
      <h1 id="nf-title">Page not found</h1>
      <p>The page you requested does not exist or has moved.</p>
      <p><a class="btn btn--primary" routerLink="/dashboard">Go to the dashboard</a></p>
    </section>
  `,
})
export class NotFoundComponent {}
