# RESORIXtrack - developer & operator shortcuts. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help
VENV := .venv/bin
DEVAPP := resorixtrack:create_app('development')

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}'

# ---------------------------------------------------------------- development
setup: ## One-time setup (venv, deps, browsers, database)
	scripts/setup.sh

dev: ## Run API + frontend dev servers (+ Mailpit) with hot reload
	scripts/dev.sh

seed: ## Load demo data into the dev database
	scripts/seed.sh

reset: ## Wipe the dev database and load fresh demo data
	scripts/seed.sh --reset

migration: ## Create a new DB migration: make migration m="describe change"
	@test -n "$(m)" || (echo 'usage: make migration m="describe change"'; exit 1)
	cd backend && FLASK_APP="$(DEVAPP)" ../$(VENV)/flask db migrate -d resorixtrack/migrations -m "$(m)" \
		--rev-id $$(printf '%04d' $$(( $$(ls resorixtrack/migrations/versions/*.py | wc -l) + 1 )))

lock: ## Regenerate backend/requirements.lock (hash-pinned) after changing pyproject dependencies
	cd backend && uv pip compile pyproject.toml --generate-hashes --python-version 3.12 -o requirements.lock

migrate: ## Apply migrations to the dev database
	cd backend && FLASK_APP="$(DEVAPP)" ../$(VENV)/flask resorixtrack migrate

# ---------------------------------------------------------------- quality
lint: ## Lint backend (ruff) and check translations
	cd backend && ../$(VENV)/ruff check resorixtrack tests
	cd frontend && node scripts/i18n-check.mjs
	.venv/bin/python scripts/licenses.py --check

test: ## All tests: lint, pytest, vitest, build, Playwright E2E
	scripts/test.sh all

test-backend: ## Backend unit + API integration tests with coverage
	scripts/test.sh backend

test-frontend: ## Frontend unit tests, i18n check, build
	scripts/test.sh frontend

test-e2e: ## Browser end-to-end tests (Playwright)
	scripts/test.sh e2e

smoke: build ## Build the Docker image and run the container smoke test
	scripts/smoke.sh

# ---------------------------------------------------------------- build & deploy
build-frontend: ## Build the static frontend into frontend/dist
	cd frontend && npm run build --silent

screenshots: ## Regenerate docs/screenshots from a seeded throwaway instance
	scripts/screenshots.sh

build: ## Build the production Docker image
	scripts/build.sh

up: ## Start the production stack (docker compose)
	docker compose up -d

up-tls: ## Start the production stack with Caddy (automatic HTTPS)
	docker compose --profile tls up -d

down: ## Stop the stack
	docker compose down

logs: ## Follow logs
	docker compose logs -f --tail=100

backup: ## Create a backup in the running stack and copy it to ./backups
	scripts/backup.sh

restore: ## Restore an encrypted backup: make restore f=backups/<file>.zip.enc
	scripts/restore.sh $(f)

admin: ## Create an administrator in the running stack: make admin email=.. name=..
	docker compose exec app flask resorixtrack create-admin --email "$(email)" --name "$(name)"

.PHONY: help setup dev seed reset migration lock migrate lint test test-backend test-frontend test-e2e smoke \
	screenshots build-frontend build up up-tls down logs backup restore admin
