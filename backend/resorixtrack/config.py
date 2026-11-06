# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Environment-driven configuration (12-factor)."""

from __future__ import annotations

import os
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    val = os.environ.get(name)
    return int(val) if val not in (None, "") else default


def _secret(name: str, default: str = "") -> str:
    """Read a secret from NAME, or from the file named by NAME_FILE (Docker/Compose secrets)."""
    path = os.environ.get(f"{name}_FILE")
    if path:
        return Path(path).read_text(encoding="utf-8").strip()
    return os.environ.get(name, default)


class Config:
    ENV_NAME = "production"
    TESTING = False
    DEBUG = False

    SECRET_KEY = _secret("SECRET_KEY")
    DATA_DIR = Path(os.environ.get("RESORIXTRACK_DATA_DIR", "/data"))
    # Absolute URL used in emails (invite / reset links).
    BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
    # Shown as "Source code" on the sign-in page. AGPL section 13: if you modify RESORIXtrack and let others use it
    # over a network, point this to the source of your version.
    SOURCE_URL = os.environ.get("SOURCE_URL", "https://github.com/RESORIX-AG/RESORIXtrack").strip()
    # Directory with the built Astro frontend (served by Flask).
    FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "")

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Never echo bound parameters (emails, hashes) into error logs.
    SQLALCHEMY_ENGINE_OPTIONS = {"hide_parameters": True}

    # Sessions
    SESSION_COOKIE_NAME = "rt_session"
    CSRF_COOKIE_NAME = "rt_csrf"
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", True)
    SESSION_REMEMBER_DAYS = _int("SESSION_REMEMBER_DAYS", 30)
    SESSION_SHORT_IDLE_HOURS = _int("SESSION_SHORT_IDLE_HOURS", 12)
    # Hard cap for any session, however often it is used ("keep me signed in" slides up to this).
    SESSION_ABSOLUTE_DAYS = _int("SESSION_ABSOLUTE_DAYS", 90)
    # First-run setup needs the one-time code printed by `flask resorixtrack migrate` / `setup-code`.
    SETUP_CODE_REQUIRED = _bool("SETUP_CODE_REQUIRED", True)
    # New passwords are checked against Have I Been Pwned (k-anonymity; only a 5-character hash prefix is sent).
    PWNED_PASSWORDS_CHECK = _bool("PWNED_PASSWORDS_CHECK", True)

    # Login throttling
    LOGIN_MAX_FAILURES = _int("LOGIN_MAX_FAILURES", 8)
    LOGIN_WINDOW_MINUTES = _int("LOGIN_WINDOW_MINUTES", 15)

    # Reverse proxy: number of trusted proxies in front of the app (Caddy/Traefik/nginx).
    # 0 = the app is reached directly; X-Forwarded-* headers are then ignored (they could be forged).
    TRUSTED_PROXIES = _int("TRUSTED_PROXIES", 0)

    # Mail
    SMTP_HOST = os.environ.get("SMTP_HOST", "")
    SMTP_PORT = _int("SMTP_PORT", 587)
    SMTP_USER = os.environ.get("SMTP_USER", "")
    SMTP_PASSWORD = _secret("SMTP_PASSWORD")
    SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "starttls").lower()  # starttls | ssl | none
    # Sending a password over an unencrypted SMTP connection is refused unless explicitly allowed.
    SMTP_ALLOW_PLAINTEXT_AUTH = _bool("SMTP_ALLOW_PLAINTEXT_AUTH", False)
    SMTP_TIMEOUT = _int("SMTP_TIMEOUT", 20)
    MAIL_FROM = os.environ.get("MAIL_FROM", "RESORIXtrack <resorixtrack@localhost>")
    MAIL_SYNC = _bool("MAIL_SYNC", False)  # send in-request instead of background thread

    # Key for sealing month sign-offs (defaults to SECRET_KEY). Keep it stable: changing it makes
    # existing seals show as invalid in the integrity check.
    SIGNOFF_KEY = _secret("SIGNOFF_KEY")

    # Attachments
    ATTACHMENT_MAX_MB = _int("ATTACHMENT_MAX_MB", 10)
    MAX_CONTENT_LENGTH = (_int("ATTACHMENT_MAX_MB", 10) + 1) * 1024 * 1024

    # Backups
    BACKUP_KEEP = _int("BACKUP_KEEP", 14)
    # Every backup is encrypted with this password (Argon2id + ChaCha20-Poly1305). Mandatory in production.
    BACKUP_PASSWORD = _secret("BACKUP_PASSWORD")

    # OpenAPI (flask-smorest)
    API_TITLE = "RESORIXtrack API"
    API_VERSION = "v1"
    OPENAPI_VERSION = "3.0.3"
    OPENAPI_URL_PREFIX = "/api"
    OPENAPI_JSON_PATH = "openapi.json"
    OPENAPI_SWAGGER_UI_PATH = "/docs"
    OPENAPI_SWAGGER_UI_URL = "/vendor/swagger-ui/"  # vendored by the frontend build, never a CDN
    API_SPEC_OPTIONS = {
        "info": {"description": "RESORIXtrack REST API. Authenticate with a session cookie (web) "
                                "or `Authorization: Bearer rt_...` personal access token."},
        "components": {"securitySchemes": {
            "bearerAuth": {"type": "http", "scheme": "bearer"},
            "cookieAuth": {"type": "apiKey", "in": "cookie", "name": "rt_session"},
        }},
        "security": [{"bearerAuth": []}, {"cookieAuth": []}],
    }

    @classmethod
    def database_uri(cls) -> str:
        return os.environ.get("DATABASE_URL") or f"sqlite:///{cls.DATA_DIR / 'resorixtrack.db'}"


class DevConfig(Config):
    ENV_NAME = "development"
    DEBUG = True
    SECRET_KEY = _secret("SECRET_KEY", "dev-insecure-secret-key-change-me")
    BACKUP_PASSWORD = _secret("BACKUP_PASSWORD", "dev-backup-password")
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", False)
    SETUP_CODE_REQUIRED = _bool("SETUP_CODE_REQUIRED", False)
    PWNED_PASSWORDS_CHECK = _bool("PWNED_PASSWORDS_CHECK", False)
    SQLALCHEMY_ENGINE_OPTIONS = {}
    DATA_DIR = Path(os.environ.get("RESORIXTRACK_DATA_DIR", Path(__file__).resolve().parents[2] / "var"))
    BASE_URL = os.environ.get("BASE_URL", "http://localhost:4321").rstrip("/")
    SMTP_HOST = os.environ.get("SMTP_HOST", "localhost")
    SMTP_PORT = _int("SMTP_PORT", 1025)
    SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "none").lower()


class TestConfig(Config):
    ENV_NAME = "testing"
    TESTING = True
    SECRET_KEY = "test-secret-key"
    BACKUP_PASSWORD = "test-backup-password"
    SESSION_COOKIE_SECURE = False
    SETUP_CODE_REQUIRED = False
    PWNED_PASSWORDS_CHECK = False
    SQLALCHEMY_ENGINE_OPTIONS = {}
    BASE_URL = "http://testserver"
    SMTP_HOST = ""
    MAIL_SYNC = True
    LOGIN_MAX_FAILURES = 5


CONFIGS = {"production": Config, "development": DevConfig, "testing": TestConfig}
