# Development

## Setup

Requirements: Python 3.12+, Node 22+, and Docker (optional, for Mailpit and the container smoke test). On Debian/Ubuntu the PDF renderer needs `libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b`.

```bash
make setup     # .venv with backend deps, frontend node modules, Playwright Chromium, dev database
make seed      # demo company: 3 teams, 11 people, ~3 months of entries, Fribourg holidays
make dev       # Flask API (debug, reload) on :5000 + Astro dev server on :4321 + Mailpit on :8025
```

Open http://localhost:4321 and sign in with a demo account. Every email lands in Mailpit at http://localhost:8025.

## Demo accounts

`make seed` (or `make reset` to wipe and reseed) creates these accounts. **All of them use the password `demo`.** Seeding refuses to run in production (`RESORIXTRACK_ENV=production`), so this password never exists on a real installation; the password rules (length, breach check) apply only when someone sets a password through the app.

| Name | Email | Role | Team | Level | UI |
|---|---|---|---|---|---|
| RESORIXtrack Admin | `admin@example.nomail` | Administrator with HR + Projects | – | 100 % | de |
| Luca Bianchi | `luca.bianchi@example.nomail` | Team lead | RF Engineering | 100 % | en |
| Anna Meier | `anna.meier@example.nomail` | Employee | RF Engineering | 100 % | de |
| Marc Dubois | `marc.dubois@example.nomail` | Employee | RF Engineering | 80 % (Mon–Thu) | en |
| Sofia Rossi | `sofia.rossi@example.nomail` | Employee, deputy lead for 14 days | RF Engineering | 100 % | en |
| Jonas Keller | `jonas.keller@example.nomail` | Team lead | Software & DSP | 100 % | de |
| Lea Schneider | `lea.schneider@example.nomail` | Employee | Software & DSP | 100 % | de |
| Noah Favre | `noah.favre@example.nomail` | Employee | Software & DSP | 60 % (Mon–Wed) | en |
| Mia Brunner | `mia.brunner@example.nomail` | Employee | Software & DSP | 100 % | en |
| Elena Kovac | `elena.kovac@example.nomail` | Employee | Operations (no lead) | 100 % | en |
| Tim Baumann | `tim.baumann@example.nomail` | Employee | Operations (no lead) | 100 % | de |

Different demo password: `cd backend && FLASK_APP="resorixtrack:create_app('development')" ../.venv/bin/flask resorixtrack seed-demo --password '…'`.

## Make targets

| Command | Purpose |
|---|---|
| `make test` | everything: ruff, pytest (coverage gate 85 %), vitest, i18n check, frontend build, Playwright e2e |
| `make test-backend` / `test-frontend` / `test-e2e` | the parts |
| `make lint` | ruff + translation completeness |
| `make migration m="add x"` | new Alembic migration (review it!) · `make migrate` applies to the dev DB |
| `make lock` | regenerate `backend/requirements.lock` (hash-pinned) after changing dependencies |
| `make build` / `make smoke` | Docker image / container smoke test (setup code, clocking, PDF, backup, CSP) |
| `make screenshots` | regenerate `docs/screenshots/` from a seeded throwaway instance |
| `make backup` / `make restore f=…` | operate a running stack |

To debug the backend alone: `cd backend && FLASK_APP="resorixtrack:create_app('development')" ../.venv/bin/flask run --debug`, or use the VS Code launch configurations in `.vscode/launch.json`.

## Architecture in short

- **Backend** (`backend/resorixtrack/`): Flask app factory; `models.py` (SQLAlchemy), `services/` (all business logic: accounts engine, entries/clock state machine, absences, users, sign-offs, reports, mail, backup, branding, settings), `api/` (flask-smorest blueprints with marshmallow schemas → OpenAPI), `auth.py` (sessions, tokens, CSRF, decorators), `db_guards.py` (SQLite triggers), `migrations/` (Alembic), `cli.py`, `worker.py`.
- **Frontend** (`frontend/src/`): Astro static pages that mount Preact islands (`views/`), shared `components/`, `lib/` (API client, i18n, time helpers, store, clock with offline queue, branding), `styles/theme.css` (design tokens) and `global.css`, `i18n/<locale>/*.json`.
- Time is stored in **UTC** and displayed in the person's timezone; day boundaries are computed per person.
- Each sign-in session, API token and email link is stored only as a hash.

## Tests

| Suite | Covers |
|---|---|
| `backend/tests/test_accounts_unit.py` | target/balance engine: holidays (both modes, half days), absences in halves, DST, entries across midnight, timezones |
| `test_auth_api.py` | Argon2id, sessions (sliding + absolute cap), CSRF, throttling (email+IP, forgot), reset/invite flows, tokens and scopes, token revocation, setup code, sign-in log, masking |
| `test_entries_api.py` | clock state machine, offline timestamps, reasons, lead corrections, disputes, employment period, single open entry |
| `test_absences_api.py` | vacation workflow, approvals, cancellations, sick self-report rules, documents, team-calendar privacy, carry-over |
| `test_isolation.py` | crawls every API route as an employee (session + token) and a foreign lead |
| `test_reports_admin.py` | PDF/XLSX/CSV reports, settings, SMTP test, backups and restore, audit log, holidays |
| `test_signoffs.py` | sign-off permissions and blockers, immutability via API / raw SQL / ORM, reopening, seals, chain, tampering detection, guard self-healing |
| `test_branding.py` | logo upload (SVG sanitising, PNG), accent colour, email logo selection |
| `test_mfa.py` | TOTP enrolment, second sign-in step, replay guard, recovery codes, throttling, admin reset, session-only routes |
| `test_privacy.py` | per-person export (self and admin), anonymisation (files, logs, history scrubbing, guard re-installed), CLI |
| `test_roles.py` | administrators see no time data, HR capability, several leads, deputies with periods, approvals fallback, projects capability |
| `test_worklog.py` | projects (visibility, lead/admin management), work-log items (validation, permissions, audit), required mode (coverage, sign-off blocker, immutability), project report |
| `test_migrations.py` | single head, no model drift, upgrade from every revision with data, pre-migration backup, newer-DB refusal |
| `test_web_security.py` | hashing, policy, headers, CSP hashes, docs behind login, static traversal |
| `frontend/tests/unit` | duration/date helpers, i18n (plurals, fallbacks), API client, redirect safety |
| `frontend/tests/e2e` | sign-in and redirects, clocking and shortcuts, edits with reason and history, lead correction → notification, vacation request → approval, sick report + upload, language switch, admin pages, sign-off, mobile |

## Migrations

One linear chain starting at `0001` (the complete schema incl. the frozen database guards); released migrations are never edited, every change must preserve data. `make migration m="…"` generates the next revision; review it (batch mode is enabled for SQLite). `tests/test_migrations.py` upgrades from every historical revision with data and compares the result with the models.

## Translations

`node frontend/scripts/i18n-check.mjs` fails the build when a key is missing in a locale or placeholders differ. See [customizing.md](customizing.md#languages).

## Releasing

1. Bump `__version__` in `backend/resorixtrack/__init__.py`, `version` in `backend/pyproject.toml` and `frontend/package.json`; add a section to `CHANGELOG.md`.
2. `make test && make smoke`.
3. `make screenshots` – the images in README.md and docs/ are embedded from `docs/screenshots/` and must show the current UI; review the changed ones.
4. Tag, push; operators update with `git pull && docker compose up -d --build`.

## Working with coding agents

[AGENTS.md](../AGENTS.md) is the instruction file for coding agents (Claude Code reads it through `CLAUDE.md`): where the documentation lives, the rules that must hold, and the checks to run before finishing.
