# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""SMTP mail with localized Jinja templates (HTML + text), sent after the request commits."""

from __future__ import annotations

import contextlib
import smtplib
import ssl
import threading
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Any

from flask import Flask, current_app, g, has_request_context, render_template
from jinja2 import TemplateNotFound

from . import branding
from . import settings as settings_svc


@dataclass
class Mail:
    to: str
    subject: str
    text: str
    html: str
    meta: dict[str, Any] = field(default_factory=dict)


ABSENCE_LABELS_DE = {
    "vacation": "Ferien", "sick": "Krankheit", "accident": "Unfall", "child_sick": "Pflege krankes Kind",
    "military": "Militär / Zivildienst", "training": "Weiterbildung", "comp_time": "Kompensation",
    "special": "Sonderurlaub", "unpaid": "Unbezahlter Urlaub",
}

ABSENCE_LABELS_FR = {
    "vacation": "Vacances", "sick": "Maladie", "accident": "Accident", "child_sick": "Garde d'enfant malade",
    "military": "Service militaire / civil", "training": "Formation", "comp_time": "Compensation",
    "special": "Congé spécial", "unpaid": "Congé non payé",
}

ABSENCE_LABELS = {"de": ABSENCE_LABELS_DE, "fr": ABSENCE_LABELS_FR}


def absence_type_label(t: Any, locale: str) -> str:
    labels = ABSENCE_LABELS.get(locale)
    if labels:
        return labels.get(getattr(t, "key", ""), getattr(t, "label", ""))
    return getattr(t, "label", "")


def _render(template: str, locale: str, ctx: dict[str, Any]) -> tuple[str, str, str]:
    """Templates are text files with top-level ``{% set subject/cta_url/cta_label %}``.

    The HTML version is generated from the text paragraphs inside a branded layout.
    """
    env = current_app.jinja_env
    for loc in (locale, "en"):
        try:
            tmpl = env.get_template(f"email/{loc}/{template}.txt")
        except TemplateNotFound:
            continue
        t = ctx.get("type")
        ctx = {**ctx, "type_label": absence_type_label(t, loc) if t is not None else ""}
        module = tmpl.make_module(ctx)
        text = str(module).strip() + "\n"
        subject = str(getattr(module, "subject", template)).strip()
        cta_url = getattr(module, "cta_url", None)
        cta_label = getattr(module, "cta_label", None)
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip() and p.strip() != cta_url]
        html = render_template("email/base.html", subject=subject, paragraphs=paragraphs, cta_url=cta_url,
                               cta_label=cta_label, locale=loc, has_logo=branding.email_logo_path() is not None, **ctx)
        return subject, text, html
    raise TemplateNotFound(template)


def build(template: str, to: str, locale: str = "en", **ctx: Any) -> Mail:
    base = {
        "company": settings_svc.get("company_name"),
        "base_url": current_app.config["BASE_URL"],
    }
    base.update(ctx)
    subject, text, html = _render(template, locale or "en", base)
    logo = branding.email_logo_path()
    return Mail(to=to, subject=subject, text=text, html=html,
                meta={"template": template, "_logo": str(logo) if logo else None, **ctx})


def _to_message(app: Flask, mail: Mail) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = app.config["MAIL_FROM"]
    msg["To"] = mail.to
    msg["Subject"] = mail.subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain="resorixtrack")
    msg.set_content(mail.text)
    msg.add_alternative(mail.html, subtype="html")
    logo = mail.meta.get("_logo")
    if logo is not None:
        html_part = msg.get_payload()[1]
        html_part.add_related(Path(logo).read_bytes(), maintype="image", subtype="png", cid="<logo>")
    return msg


def deliver(app: Flask, mail: Mail) -> None:
    """Send synchronously. Raises on SMTP errors."""
    if app.config.get("TESTING"):
        app.extensions.setdefault("mail_outbox", []).append(mail)
        return
    cfg = app.config
    if not cfg["SMTP_HOST"]:
        app.logger.warning("SMTP_HOST not configured; dropping mail to %s (%s)", mail.to, mail.subject)
        return
    msg = _to_message(app, mail)
    security = cfg["SMTP_SECURITY"]
    ctx = ssl.create_default_context()
    if security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(cfg["SMTP_HOST"], cfg["SMTP_PORT"],
                                                timeout=cfg["SMTP_TIMEOUT"], context=ctx)
    else:
        server = smtplib.SMTP(cfg["SMTP_HOST"], cfg["SMTP_PORT"], timeout=cfg["SMTP_TIMEOUT"])
    try:
        server.ehlo()
        if security == "starttls":
            server.starttls(context=ctx)
            server.ehlo()
        if cfg["SMTP_USER"]:
            if security == "none" and not cfg.get("SMTP_ALLOW_PLAINTEXT_AUTH"):
                raise RuntimeError("Refusing to send the SMTP password over an unencrypted connection "
                                   "(set SMTP_SECURITY=starttls|ssl, or SMTP_ALLOW_PLAINTEXT_AUTH=true)")
            server.login(cfg["SMTP_USER"], cfg["SMTP_PASSWORD"])
        server.send_message(msg)
    finally:
        with contextlib.suppress(Exception):
            server.quit()


def _deliver_logged(app: Flask, mail: Mail) -> None:
    try:
        deliver(app, mail)
    except Exception:  # noqa: BLE001
        app.logger.exception("Failed to send mail to %s (%s)", mail.to, mail.subject)


def send(mail: Mail) -> None:
    """Queue for after the current request succeeds; send immediately outside requests."""
    app = current_app._get_current_object()  # type: ignore[attr-defined]
    if has_request_context():
        g.setdefault("mail_queue", []).append(mail)
        return
    _deliver_logged(app, mail)


def flush_queue(app: Flask, ok: bool) -> None:
    queue: list[Mail] = g.pop("mail_queue", [])
    if not ok or not queue:
        return
    if app.config.get("MAIL_SYNC") or app.config.get("TESTING"):
        for m in queue:
            _deliver_logged(app, m)
        return
    t = threading.Thread(target=lambda: [_deliver_logged(app, m) for m in queue], daemon=True)
    t.start()


def init_mail(app: Flask) -> None:
    @app.after_request
    def _flush(response):
        flush_queue(app, response.status_code < 400)
        return response
