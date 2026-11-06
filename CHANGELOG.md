# Changelog

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
