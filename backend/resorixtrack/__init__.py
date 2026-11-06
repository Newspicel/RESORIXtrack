# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""RESORIXtrack: self-hosted time tracking by RESORIX AG."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from flask import Flask

__version__ = "1.0.0"


def create_app(config_name: str | None = None, overrides: dict[str, Any] | None = None) -> Flask:
    from .config import CONFIGS

    config_name = config_name or os.environ.get("RESORIXTRACK_ENV", "production")
    cfg = CONFIGS[config_name]
    app = Flask(__name__, static_folder=None)
    app.config.from_object(cfg)
    app.config["SQLALCHEMY_DATABASE_URI"] = cfg.database_uri()
    if overrides:
        app.config.update(overrides)
    app.config["DATA_DIR"] = Path(app.config["DATA_DIR"])

    key = app.config["SECRET_KEY"] or ""
    if not key or (config_name == "production" and (len(key) < 32 or "change-me" in key.lower()
                                                    or len(set(key)) < 16)):
        raise RuntimeError("SECRET_KEY must be set to a long random value (at least 32 characters, "
                           "not the placeholder from .env.example): "
                           "python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"")
    bp = app.config.get("BACKUP_PASSWORD") or ""
    if config_name == "production" and (len(bp) < 12 or "change-me" in bp.lower()):
        raise RuntimeError("BACKUP_PASSWORD must be set to at least 12 characters: every backup is encrypted with it. "
                           "Keep it in your password manager - without it no backup can be restored.")
    # __Host- cookies can only be set over HTTPS and are bound to the host (no Domain, Path=/).
    if app.config["SESSION_COOKIE_SECURE"]:
        app.config["SESSION_COOKIE_NAME"] = "__Host-" + app.config["SESSION_COOKIE_NAME"]
        app.config["CSRF_COOKIE_NAME"] = "__Host-" + app.config["CSRF_COOKIE_NAME"]

    if app.config.get("TESTING"):
        from .security import use_fast_hasher

        use_fast_hasher()

    app.config["DATA_DIR"].mkdir(parents=True, exist_ok=True)
    _configure_logging(app)

    from werkzeug.middleware.proxy_fix import ProxyFix

    if app.config["TRUSTED_PROXIES"]:
        n = app.config["TRUSTED_PROXIES"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=n, x_proto=n, x_host=n)  # type: ignore[method-assign]

    from flask_smorest import Api

    from .extensions import db, migrate

    db.init_app(app)
    migrate.init_app(app, db, directory=str(Path(__file__).parent / "migrations"), render_as_batch=True)
    api = Api(app)

    from . import db_guards  # noqa: F401 - registers the SQLite triggers for create_all()
    from .errors import register_error_handlers

    register_error_handlers(app)

    from .auth import init_auth
    from .services.mail import init_mail

    init_auth(app)
    init_mail(app)

    from .api import register_blueprints

    register_blueprints(api)

    from . import web

    web.init_web(app)

    from .cli import register_cli

    register_cli(app)
    return app


def _configure_logging(app: Flask) -> None:
    level = os.environ.get("LOG_LEVEL", "DEBUG" if app.debug else "INFO").upper()
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app.logger.setLevel(level)
    for noisy in ("alembic.runtime.plugins", "alembic.runtime.migration", "fontTools", "weasyprint"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, logging.getLevelName(level) if isinstance(logging.getLevelName(level), int) else logging.INFO))
