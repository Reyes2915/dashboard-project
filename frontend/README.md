# FinOps Enterprise Dashboard — Frontend

Corporate portal for budget control, spend analytics and invoice approval, built as a **security-first Angular 22 SPA**
and hardened against the **OWASP Top 10 Web (2025)** and **OWASP API Security Top 10 (2023)**.

The backend is not required: a terminal HTTP interceptor simulates a versioned REST API (`/api/v1/*`) in memory, with
persistence in `localStorage` signed by SHA-256. Swapping it for a real backend means removing one interceptor.

| | |
|---|---|
| Framework | Angular 22 · zoneless · standalone · Signals · OnPush everywhere |
| Language | TypeScript 6.0 (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `strictTemplates`) |
| Runtime deps | `@angular/*`, `rxjs`, `tslib` — **nothing else** (no UI kits, no chart or state libraries) |
| Tests | 125 unit/integration tests (Vitest, jsdom or real headless Chromium) · 10 Playwright E2E scenarios |
| Delivery | Multi-stage Docker (`node:22-alpine` → `nginxinc/nginx-unprivileged:alpine`), GitHub Actions |

---

## Quick start

```bash
cd frontend
npm ci
npm start            # http://localhost:4200
```

| Command | Purpose |
|---|---|
| `npm run lint` | ESLint flat config (typescript-eslint strict + angular-eslint template a11y) |
| `npm run typecheck` | `tsc --noEmit` for app and specs |
| `npm test -- --watch=false` | Unit, integration and OWASP attack tests (fast, jsdom) |
| `npm run test:browser` | Same suite in real headless Chromium (`--browsers=ChromiumHeadless`) |
| `npm run e2e` | Playwright E2E (starts `npm start` automatically through `webServer`) |
| `npm run e2e:ui` / `npm run e2e:report` | Playwright UI mode / last HTML report |
| `npm run build` | Production build (`sourceMap: false`, hashed output) |
| `npm run audit:prod` | `npm audit --audit-level=high --omit=dev` |
| `npm run security:sinks` | Fails if `innerHTML`, `outerHTML`, `bypassSecurityTrust*` or `eval(` appear in `src/app` |

### One-time setup after cloning

Two hardening files are shipped under `ci/` because they cannot be written into hidden locations by the generator:

```bash
cd frontend
mkdir -p ../.github/workflows && cp ci/ci.yml ../.github/workflows/ci.yml                       # GitHub Actions
cp ci/npmrc .npmrc                                                                          # save-exact, engine-strict
```

First E2E run on a new machine: `npx playwright install chromium` (CI uses `--with-deps`).

### Docker

```bash
cd frontend
docker build -t finops-dashboard .
docker run --rm -p 8080:8080 finops-dashboard      # http://localhost:8080
curl -sI http://localhost:8080/dashboard            # inspect the security headers
```

The container runs nginx as **uid 101** on port 8080, serves read-only content, injects a **per-request CSP nonce**,
and exposes a `HEALTHCHECK`.

---

## Architecture

```
                          ┌──────────────────────────── Browser ────────────────────────────┐
                          │                                                                  │
  Routes (lazy)           │  features/dashboard   features/expenses   features/expense-form  │
  + roleGuard             │  features/security-lab                                           │
  + unsavedChangesGuard   │        │ Signals (computed)        │ FormControl → debounce →    │
  + TitleStrategy         │        ▼                           ▼ distinctUntilChanged → switchMap
                          │   DashboardFacade            ExpensesFacade / ExpenseFormFacade   │
                          │        └──────────────┬────────────┘                             │
                          │                       ▼                                          │
                          │              FinopsApiService ── runtime Type Guards (API10)     │
                          │                       │                                          │
                          │                       ▼  HttpClient (withFetch)                  │
                          │  ┌─────────────────────────────────────────────────────────────┐ │
                          │  │ 1. httpErrorInterceptor   RFC 7807, fail-closed, 401 reset   │ │
                          │  │ 2. authSecurityInterceptor Bearer, X-User-Role, Idempotency, │ │
                          │  │                            Content-Type, timeout(8000)       │ │
                          │  │ 3. mockApiInterceptor  ──► MockApiServer  (/api/v1/*)        │ │
                          │  │      versioning · rate limit · routing 404/405 · 415         │ │
                          │  │      authn 401 · role-claim check · BFLA matrix 403          │ │
                          │  │      BOLA scope · BOPLA · FSM · idempotency · SSRF policy    │ │
                          │  │      SHA-256 signed persistence ──► localStorage             │ │
                          │  └─────────────────────────────────────────────────────────────┘ │
                          │                                                                  │
                          │  core/services: RoleService (in-memory token) · SecurityAudit    │
                          │  Service (PII-masked ring buffer) · NotificationService (toasts) │
                          │  GlobalErrorHandler · HasRoleDirective · shared design system    │
                          └──────────────────────────────────────────────────────────────────┘
                                         ▲ served by nginx (CSP + nonce, HSTS, XFO, nosniff…)
```

```
src/app
├── core/          models, domain rules, security primitives, API gateway, interceptors,
│                  guards, directives, services, simulated backend (mock-api/)
├── shared/        design system: tokens/themes/a11y SCSS + KPI card, skeleton, modal,
│                  toast container, security audit drawer
└── features/      dashboard · expenses · expense-form (wizard) · security-lab · not-found
```

---

## OWASP compliance matrix

Every control is enforced **in code**, covered by **tests**, and can be **demonstrated live**. The fastest way is the
**Security lab** page (`/security-lab` → *Run all probes*): each card sends a real attack through the production HTTP
pipeline and shows the defensive response; the **Audit log** button in the header shows what the server recorded.

### OWASP Top 10 Web (2025)

| # | Risk | Implementation | How to verify live |
|---|---|---|---|
| A01 | Broken Access Control | Two barriers: UI (`*appHasRole`, `roleGuard`) and server (`ACCESS_MATRIX` in `mock-api.server.ts`). | Switch role to VIEWER: admin buttons disappear and `/expenses/new` redirects. Lab → *VIEWER tries to delete* returns **403** even though the UI was bypassed. |
| A02 | Security Misconfiguration | `nginx.conf` + `nginx/security-headers.conf`: CSP with nonce and Trusted Types, XFO `DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, HSTS, COOP/CORP/COEP, only GET/HEAD, dotfiles and `.map` blocked. Non-root container. `sourceMap: false` in production. | `curl -sI http://localhost:8080/dashboard`; `curl -X POST` → 405; `/main.js.map` → 404. |
| A03 | Software Supply Chain Failures | Zero third-party UI/chart/state libraries; `npm ci` from lockfile; `.npmrc` `save-exact`/`engine-strict`; CI audit gate. | `npm ls --omit=dev` lists only Angular, RxJS and tslib. |
| A04 | Cryptographic Failures | Bearer token is held **in memory only** (Signal), never in Web Storage; `crypto.randomUUID()` for IDs/keys; `crypto.subtle.digest('SHA-256')` signs persisted state; ESLint rule blocks persisting credentials. | DevTools → Application → Local Storage: only `finops.mockdb.v1` (signed data) and `finops.theme`. |
| A05 | Injection | Angular contextual escaping only (no `innerHTML`, no `bypassSecurityTrust*`, enforced by ESLint + CI grep); allow-list text policy; CSV export neutralises `= + - @ TAB CR` prefixes. | Create an expense titled `=HYPERLINK("http://x")` (rejected by allow-list) or export CSV and open it: formula cells are inert text. |
| A06 | Insecure Design | Finite state machine `PENDING → APPROVED \| REJECTED` (irreversible) shared by UI and API; approved records cannot be deleted; confirmation modals; `unsavedChangesGuard`. | Approve an expense: actions vanish; replaying the PATCH returns **409**. Leave the wizard with changes: a dialog asks to confirm. |
| A07 | Authentication Failures | Server-side session registry with 15-min TTL, revocation, token rotation on role switch; **401** + `WWW-Authenticate`; client performs a secure reset to a fresh VIEWER session. | Lab → *Revoke my session*: next call gets 401, the app resets to VIEWER and logs `SESSION_RESET`. |
| A08 | Software or Data Integrity Failures | Persisted state = `{schemaVersion, checksum, data}`; schema guard + SHA-256 verification on every read; on mismatch → CRITICAL alert and secure seed restore. | Edit any `netAmount` in `finops.mockdb.v1` in DevTools and refresh data (or Lab → *Tamper*): the change is reverted and an `INTEGRITY_VIOLATION` appears in the Audit log. |
| A09 | Security Logging & Alerting Failures | `SecurityAuditService`: Signal-backed, bounded (200), PII masking (tokens, emails, IBAN, cards, UUIDs), control-char stripping against log forging; accessible drawer with live region and severity filter. | Run any probe and open *Audit log*. |
| A10 | Mishandling of Exceptional Conditions | `httpErrorInterceptor` normalises every failure into RFC 7807 and fails closed; `GlobalErrorHandler` shows a reference ID only; stack traces never rendered (console only in dev). | Lab → *Internal server error*: safe message, no internals. |

### OWASP API Security Top 10 (2023)

| # | Risk | Implementation (`core/mock-api/mock-api.server.ts` unless noted) | How to verify live |
|---|---|---|---|
| API1 | BOLA | Each session has a department scope; out-of-scope objects return **404** (no existence disclosure); lists and budgets are scoped. | Lab → *Read an expense outside the user scope* → 404. As VIEWER, only Engineering/Marketing appear. |
| API2 | Broken Authentication | Every `/api/v1/*` route except `POST /auth/session` requires a valid, unexpired, non-revoked bearer token. | Lab → *Request without bearer token* / *Forged bearer token* → 401. |
| API3 | BOPLA | `POST` rejects `id`, `status`, `approvedBy`, `createdBy`, `createdAt`, `totalAmount` and unknown fields with **422**; `PATCH` accepts only `{ status }`. | Lab → *Mass assignment of privileged fields* → 422 with per-field errors. |
| API4 | Unrestricted Resource Consumption | `pageSize ≤ 50`, `search ≤ 100` chars (422); fixed-window rate limit 60 req/10 s per credential (**429** + `Retry-After`); bounded session/idempotency stores; nginx `limit_req`. | Lab → *Request burst* / *Oversized page request*. |
| API5 | BFLA | Deny-by-default `ACCESS_MATRIX`: VIEWER = GET only; POST/PATCH/DELETE = ADMIN. The `X-User-Role` header must match the session role, otherwise **403** (tampering alert). | Lab → *VIEWER tries to delete* and *Forged X-User-Role header* → 403. |
| API6 | Sensitive Business Flows | `X-Idempotency-Key` (UUID) mandatory on `POST /expenses` (**428** if missing); same key + same payload replays the original (200, `Idempotent-Replayed: true`); same key + different payload → **409**. The wizard keeps one key per submission. | Lab → *POST without X-Idempotency-Key* / *Replay the same submission twice*. |
| API7 | SSRF | `checkUrlPolicy()` (`core/security/url-policy.ts`): `https:` only, no credentials, port 443 only, blocks localhost, `.local/.internal`, single-label hosts, IPv6 literals, obfuscated numeric hosts and private/link-local/CGNAT/multicast IPv4. Applied by `safeHttpsUrlValidator` **and** by the API. | Type `http://169.254.169.254` in the wizard's receipt URL, or Lab → *Receipt URL pointing at cloud metadata* → 422. |
| API8 | Security Misconfiguration | `Content-Type: application/json` required (**415**); unknown routes 404; wrong method **405** + `Allow`; all errors are `application/problem+json`. | Lab → *Wrong Content-Type* / *Unsupported HTTP method*. |
| API9 | Improper Inventory Management | Explicit `/api/v1`; unversioned `/api/*` → **410 Gone**; unknown versions → 404. | Lab → *Unversioned legacy route* → 410. |
| API10 | Unsafe Consumption of APIs | Every response passes a runtime type guard (`core/security/payload-guards.ts`) before reaching a Signal; violations → 502 ProblemDetail + CRITICAL audit; `timeout(8000)` on every call. | Lab → *Malformed upstream payload* → 502 and a `CONTRACT_VIOLATION` event. |

---

## Testing strategy

| Layer | Tooling | What it proves |
|---|---|---|
| Unit | Vitest + TestBed (`src/**/*.spec.ts`) | Facades (debounce, `switchMap` cancellation, error states), validators (21 SSRF cases), CSV formula injection, PII masking, type guards, FSM, Web Crypto checksum. |
| Integration | Vitest + real `HttpClient` + interceptor chain | Every API defence of the simulated server: 401/403/404/405/409/410/415/422/428/429, mass assignment, BOLA scope, idempotent replay, SHA-256 tamper recovery; all 17 Security Lab probes end-to-end. |
| E2E | Playwright (`e2e/*.spec.ts`, Chromium) | Real user journeys in the running app, with role/label locators that double as accessibility assertions. |

**`e2e/finops-flows.spec.ts`**
- ADMIN completes the 3-step wizard: async invoice check (`INV-1001` → *already registered*, fresh code → *Available*),
  live VAT/total, review, submit → toast → reactive search finds it → approval through the confirmation modal →
  status *Approved* and no further actions (FSM).
- Debounced search + status filter; `aria-sort` cycling; keyboard navigation of the SVG bar chart.

**`e2e/security-and-a11y.spec.ts`**
- Switching to VIEWER removes privileged controls from the DOM, the route guard refuses `/expenses/new`, and a forced
  `DELETE` is answered **403**, visible as `AUTHZ_DENIED · BFLA blocked` in the Security audit drawer.
- Deliberate `localStorage` tampering (amount + status) is detected on the next read: KPIs unchanged, signed seed
  restored, `INTEGRITY_VIOLATION · CRITICAL` logged.
- SSRF: `http://127.0.0.1`, `https://127.0.0.1`, `https://169.254.169.254` are rejected inline and the wizard cannot advance.
- Keyboard: skip link, modal focus trap in both directions, `Escape` closes and restores focus to the opener; audit drawer
  opens from the keyboard, focuses its heading and returns focus to its toggle; high-contrast toggle (`aria-pressed`, persisted).

## Accessibility (WCAG 2.2 AA)

- Skip link, landmark structure, unique page titles (`AppTitleStrategy`), focus moved to `<main>` on navigation.
- Light theme and `[data-theme="high-contrast"]` (also auto-enabled by `prefers-contrast: more`); all text pairs ≥ 4.5:1.
- Targets ≥ 24×24 px (primary controls 40 px), visible `:focus-visible` ring, `prefers-reduced-motion` honoured.
- Modal: native `<dialog>` + `aria-modal`, focus trap, `Escape`, focus restoration.
- Toasts in an `aria-live="polite"` region; sortable headers expose `aria-sort`; wizard uses `aria-current="step"`.
- Charts: keyboard navigable (arrows/Home/End with roving tabindex), text alternative per mark, legend that never relies
  on colour alone, and a data table for each chart.

---

## Architecture Decision Records

**ADR-001 · Zoneless + Signals + OnPush.** Change detection is driven by Signals only (`provideZonelessChangeDetection`).
Removes zone.js from the bundle, makes rendering deterministic and testable. Facades expose read-only Signals and
`computed()` projections; RxJS is used only where time matters (debounce, cancellation, timeouts).

**ADR-002 · Simulated backend as a terminal interceptor.** The mock server sits *behind* the real interceptor chain, so
authentication, timeouts and error handling are exercised exactly as in production. It is the authoritative security
barrier of the demo: every UI restriction is re-checked server-side. Requests are processed serially (single-threaded
server semantics) so persistence stays consistent.

**ADR-003 · SHA-256 checksum, not HMAC.** A browser-only demo cannot keep a secret key, so the checksum detects
tampering of persisted state but does not authenticate it (an attacker could recompute it). A real backend must use an
HMAC or signature with a server-held key; the envelope format already supports swapping the algorithm.

**ADR-004 · No third-party UI, chart or state libraries.** Charts are hand-written SVG, layout is CSS Grid/Container
Queries, state is Signals. Smaller attack surface and bundle (≈102 kB initial, compressed), no transitive UI deps to audit.

**ADR-005 · Least privilege by default.** Every visit starts with a VIEWER session; role switches rotate the token and
revoke the previous one; a 401 on the user's own session triggers a secure reset to VIEWER.

**ADR-006 · Fail closed.** Unknown response shapes, timeouts, unverifiable invoice codes and integrity mismatches are all
treated as errors, never as partially trusted data.

**ADR-007 · Vitest instead of Karma, Playwright for E2E.** Angular 21+ ships Vitest as the default runner: locally it runs
in jsdom for speed, in CI it runs in real headless Chromium through `@vitest/browser-playwright`, sharing the browser
binary with the Playwright E2E suite (one `playwright install`). Karma's `ChromeHeadless` name maps to Vitest's `chrome`,
which the Playwright provider does not accept, so the flag is `--browsers=ChromiumHeadless`.

**ADR-008 · E2E against the dev server with the in-app API.** `webServer` runs `npm start`; because the simulated backend
lives in the app, every test gets an isolated, freshly seeded "database" through its own browser context, so tests are
parallel-safe and need no fixtures or teardown.

---

## Known limitations

- The role selector simulates an identity provider: any visitor can obtain an ADMIN session. This is intentional for
  demos; in production the token comes from an OIDC flow and the server owns the role.
- `npm audit --audit-level=high` (full tree) currently reports `picomatch` (ReDoS, no patched release yet) through Angular CLI/Vite
  **build tooling only**. CI blocks on runtime dependencies (`--omit=dev`, 0 vulnerabilities) and reports the full tree.
- HSTS only takes effect when the container is served over HTTPS (TLS terminates at the ingress/load balancer).
