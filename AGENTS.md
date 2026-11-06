# Instructions for coding agents

RESORIXtrack is a self-hosted time-tracking application by RESORIX AG: Flask + SQLite backend, Astro + Preact frontend, Docker Compose deployment. This file tells you where things are documented and which rules must hold. Read the relevant document before changing an area; do not duplicate its content here.

## Where to read

| Topic | Read |
|---|---|
| What the product is, features, screenshots, license | [README.md](README.md) |
| Running locally, demo accounts, make targets, tests, migrations, translations, releasing | [docs/development.md](docs/development.md) |
| Production installation, environment variables (`.env`), updates | [docs/installation.md](docs/installation.md), [.env.example](.env.example) |
| Security model: roles, isolation, sessions, tokens, two-factor, sign-off seals, operator checklist | [docs/security.md](docs/security.md), [SECURITY.md](SECURITY.md) |
| Backups (encrypted) and restore | [docs/backup-restore.md](docs/backup-restore.md) |
| REST API and access tokens | [docs/api.md](docs/api.md) |
| Administrator's guide (setup, people, teams, roles, settings) | [docs/admin-guide.md](docs/admin-guide.md) |
| User manual (employees, leads) | [docs/user-manual.md](docs/user-manual.md) |
| Logo, colours, theme tokens | [docs/customizing.md](docs/customizing.md) |
| License (AGPL-3.0-or-later, commercial option, contributions) | [LICENSING.md](LICENSING.md), [docs/third-party-licenses.md](docs/third-party-licenses.md) |
| Release notes | [CHANGELOG.md](CHANGELOG.md) |
| Database migrations | [backend/resorixtrack/migrations/README](backend/resorixtrack/migrations/README) |

`PLAN.md` (git-ignored, may be absent) holds the owner's private working notes; it is not documentation.

## Layout

- `backend/resorixtrack/` – Flask app: `api/` (routes, marshmallow schemas), `services/` (business logic; routes stay thin), `models.py`, `migrations/`, `templates/` (emails, PDFs), `cli.py`, `worker.py`.
- `frontend/src/` – Astro pages (`pages/`), Preact views (`views/`), shared components (`components/`), `lib/` (api, store, i18n, time), translations `i18n/{en,de,fr}/*.json`, theme tokens `styles/theme.css`.
- `scripts/` – setup, dev, seed, test, build, smoke, backup, restore, screenshots. `docker/` – image and entrypoint.

## Rules that must hold

- **Privacy and isolation.** Employees never see other people's data; administrators see no working times (the HR capability does); team leads and deputies see their teams only; API tokens never see more than their owner and only within their scopes. `backend/tests/test_isolation.py` crawls the API for leaks – extend it when you add routes or parameters.
- **Signed-off months are immutable** on every level (UI, services, SQLite triggers, HMAC seal chain). Never bypass the guards.
- **Every change to time data is logged** with who, when, what and why (`services/revisions.py`).
- **Backups are always encrypted**; no unencrypted archive is written to disk.
- **Passwords**: Argon2id only; the app never stores or logs a plaintext password or token.
- **Three languages.** Every UI string lives in `frontend/src/i18n/{en,de,fr}`; `node scripts/i18n-check.mjs` must pass. Emails and PDF labels are translated in the backend.
- **No bloat.** Add a dependency only when it clearly pays for itself; keep the lock files hash-pinned (`make lock`), then run `scripts/licenses.py --write` – the license check fails on anything outside the reviewed allow-list.
- **Strict CSP.** Inline scripts are allowed only through the hash list the build generates (see docs/security.md); never add `unsafe-inline`. No remote resources in emails.
- **Schema changes** go into Alembic migrations (`make migration m="..."`); before the first release the schema lives in a single migration `0001_initial_schema.py` that is regenerated, see docs/development.md.
- **Git.** Only the owner pushes. Do not commit or push unless asked.

## Checks before you finish

```bash
make lint            # ruff + translation check
make test-backend    # pytest with coverage threshold
make test-frontend   # vitest, i18n check, build
make test-e2e        # Playwright against a seeded throwaway instance
make smoke           # Docker image build + container smoke test (slower)
make screenshots     # after visible UI changes (docs/screenshots)
```

Demo data: `make reset` (password `demo`, accounts in docs/development.md, addresses end in `@example.nomail` so no real mail is ever sent).
