import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch(() => {
  // Fail closed without leaking internals: render a static, safe message.
  const root = document.querySelector('app-root');
  if (root !== null) root.textContent = 'The application could not start. Please reload the page.';
});
