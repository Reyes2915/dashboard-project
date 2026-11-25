import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/handlers/global-error.handler';
import { authSecurityInterceptor } from './core/interceptors/auth-security.interceptor';
import { httpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { mockApiInterceptor } from './core/interceptors/mock-api.interceptor';
import { AppTitleStrategy } from './core/services/app-title.strategy';
import { RoleService } from './core/services/role.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideHttpClient(
      withFetch(),
      // Order matters: error boundary (outermost) -> credentials + timeout -> simulated backend (terminal).
      withInterceptors([httpErrorInterceptor, authSecurityInterceptor, mockApiInterceptor]),
    ),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Least privilege by default: every visit starts with a read-only session.
    provideAppInitializer(() => firstValueFrom(inject(RoleService).startSession('VIEWER'))),
  ],
};
