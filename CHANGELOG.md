# Changelog

## 2.0.0 (unreleased)

Complete rewrite. Migrating from 1.x: [docs/migration-from-v1.md](docs/migration-from-v1.md).

- Stack: TanStack Start (React 19, SSR), Drizzle + SQLite, Better Auth, shadcn/ui on Base UI, Node 26. One service layer for the web app, REST API, worker and CLI (`rt`).
- New UI: calmer dark and light themes that follow the device (or System / Light / Dark in the top bar), less text, mobile tab bar, command palette, accessible keyboard use.
- Period totals (month, week, timesheet, team) count complete days only: today is shown as in progress with its time so far, so a running day no longer shows a deficit.
- Long lists render only the rows in view (TanStack Virtual); the audit and sign-in logs load older entries while scrolling instead of page buttons.
- Swiss law: checks for breaks, daily rest, day span, night and Sunday work, weekly maximum, Überzeit per day and year, consecutive days, minimum vacation; full, simplified or waived recording per person; labour-law report; retention setting (minimum 5 years). See [docs/compliance.md](docs/compliance.md).
- Sunday, holiday and night work: compensatory rest check (ArG Art. 20), Sunday/holiday supplement (default 50 %) reported for payroll or credited as time, 10 % time credit for regular night work (Art. 17b), Sunday/holiday/night hours in the timesheet and balances exports.
- Public holidays: Swiss presets only (26 cantons, City of Fribourg), topped up with next year's holidays every 1 October, optional company days in one click.
- Italian as fourth language (UI, emails, PDF and spreadsheet exports).
- revDSG: privacy notice page, record of processing template, anonymisation only after the retention period.
- Sign-in: passkeys, single sign-on via OpenID Connect (e.g. Pocket ID, optional OIDC-only mode with break-glass), sessions listed and revocable per device.
- API: Better Auth API keys with scopes `time`, `absences`, `reports`; OpenAPI 3.1 at `/api/v1/openapi.json`, reference at `/api/v1/docs`; per-key rate limit.
- Security: CSP with per-request nonces, CSRF origin check, sign-off seals in RFC 8785 JSON chained onto v1 seals, weekly integrity check by the worker.
- Backups: same encrypted RTBK1 format, now including logos and per-file checksums; `rt restore` detects v1 archives.
- Migration: `rt import-v1` imports a v1 database with ids, passwords, documents and seals; verifies every seal chain; reports who must re-enrol two-factor, create new API keys or get a new invitation. v1 files are never modified.
- Not carried over from 1.x: API tokens (replaced by API keys), sessions, TOTP secrets (re-enrolment).

## 1.0.0 – 2026-11-06

First public release.

- One-click clocking (web, keyboard shortcuts, offline queue, clock in or out with a custom time), time and vacation accounts, versioned work schedules; per-person 24-hour or 12-hour time format.
- Work log: describe what was done while clocked in (free text and/or projects managed by team leads); optional or required with a configurable share of the worked time; project report.
- Absence workflow (requests with a calendar showing holidays and existing absences, approvals, sick self-reports with documents), public-holiday calendars with import and Swiss presets; vacation entitlement optionally pro-rated by scheduled days per week.
- Month sign-off with four enforcement levels (UI, services, SQLite triggers, HMAC seal chain) and an integrity check.
- Reports (timesheet, balances, absences, raw entries) as PDF, XLSX, CSV, localised in English, German and French.
- Roles: administrators without access to time data, HR and Projects capabilities, several leads per team, deputies with validity periods.
- Administration: setup wizard with one-time setup code, getting-started checklist, employees, teams, holidays, working-time rules, absence types, branding (logo and accent colour), backups, audit and sign-in logs.
- Security: Argon2id with breached-password check, two-factor authentication (TOTP with recovery codes; can be required for administrators or everyone), encrypted backups (Argon2id + ChaCha20-Poly1305, mandatory backup password), server-side sessions with absolute lifetime, `__Host-` cookies, CSRF, scoped and expiring API tokens, strict CSP without inline scripts, throttling per email+IP, hardened Docker Compose stack, hash-pinned dependencies.
- Data protection: per-person JSON export, anonymisation of former employees, attachment purge command.
- License: AGPL-3.0-or-later; a commercial license is available from RESORIX AG (mail@resorix.ch).
- REST API with OpenAPI documentation for desktop clients; per-user access tokens with scopes, expiry and a full audit trail (creation, use, revocation; administrator overview); apps obtain a token by signing in with password and two-factor code (`POST /auth/token`).
