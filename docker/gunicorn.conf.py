# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Gunicorn settings (override with env: WEB_WORKERS, WEB_THREADS, WEB_TIMEOUT)."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
worker_class = "gthread"
workers = int(os.environ.get("WEB_WORKERS", "2"))
threads = int(os.environ.get("WEB_THREADS", "4"))
timeout = int(os.environ.get("WEB_TIMEOUT", "120"))  # PDF reports can take a few seconds
graceful_timeout = 30
keepalive = 5
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
# X-Forwarded-* headers are only honoured when the operator declared a reverse proxy (TRUSTED_PROXIES >= 1);
# ProxyFix in the app then trusts exactly that many hops. Direct exposure (0) ignores them entirely.
forwarded_allow_ips = "*" if int(os.environ.get("TRUSTED_PROXIES", "0") or 0) > 0 else "127.0.0.1"
# Access log without the query string: invitation / reset tokens must never land in logs.
access_log_format = '%(h)s "%(m)s %(U)s %(H)s" %(s)s %(b)s %(D)sus'
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
