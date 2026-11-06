# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Company branding: uploaded logos (per theme variant) and the accent colour.

Logos live in ``<DATA_DIR>/branding/logo-<variant>.<svg|png>``. When no custom logo exists the
built-in default from ``static/brand`` is used, so every caller (web, email, PDF) goes through
:func:`logo_path`. Uploaded SVG is parsed and rejected if it contains anything that could run
code or load remote content; it is additionally served with a sandboxing CSP by the API.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from flask import current_app
from werkzeug.datastructures import FileStorage

from ..errors import NotFound, Validation
from . import settings as settings_svc

VARIANTS = ("dark", "light")  # "dark" = logo for dark backgrounds (light artwork), and vice versa
MAX_LOGO_BYTES = 512 * 1024
STATIC_BRAND = Path(__file__).resolve().parents[1] / "static" / "brand"
DEFAULT_LOGOS = {"dark": STATIC_BRAND / "resorix-logo-on-dark.svg", "light": STATIC_BRAND / "resorix-logo-on-light.svg"}
MIME = {"svg": "image/svg+xml", "png": "image/png"}

_FORBIDDEN_TAGS = {"script", "foreignobject", "iframe", "embed", "object", "audio", "video", "animate",
                   "animatetransform", "animatemotion", "set", "handler", "listener"}
_HREF_ATTRS = {"href", "{http://www.w3.org/1999/xlink}href"}


def branding_dir() -> Path:
    p = Path(current_app.config["DATA_DIR"]) / "branding"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _custom(variant: str) -> Path | None:
    for ext in MIME:
        p = branding_dir() / f"logo-{variant}.{ext}"
        if p.is_file():
            return p
    return None


def logo_path(variant: str) -> Path:
    """Custom logo for the variant if uploaded, else the built-in default."""
    if variant not in VARIANTS:
        raise NotFound("Unknown logo variant")
    return _custom(variant) or DEFAULT_LOGOS[variant]


def mimetype(path: Path) -> str:
    return MIME.get(path.suffix.lstrip(".").lower(), "application/octet-stream")


def email_logo_path() -> Path | None:
    """Email clients render PNG reliably but not SVG: use the custom PNG if present, else the
    built-in PNG; no image at all when a custom SVG-only branding is in place."""
    custom_light, custom_dark = _custom("light"), _custom("dark")
    if custom_light or custom_dark:
        for p in (custom_light, custom_dark):
            if p is not None and p.suffix == ".png":
                return p
        return None
    default = STATIC_BRAND.parent / "email-logo.png"
    return default if default.is_file() else None


def info() -> dict[str, Any]:
    logos = {}
    for v in VARIANTS:
        p = _custom(v)
        logos[v] = {"custom": p is not None, "type": mimetype(p) if p else "image/svg+xml",
                    "url": f"/api/v1/branding/logo/{v}?v={int(p.stat().st_mtime) if p else 0}"}
    return {"company_name": settings_svc.get("company_name"), "accent": settings_svc.get("brand_accent") or None,
            "logos": logos}


def _sniff(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    head = data[:512].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith(b"<?xml") or head.startswith(b"<svg") or head.startswith(b"<!--"):
        return "svg"
    raise Validation("Only SVG or PNG logos are supported", fields={"file": "type"})


def _check_svg(data: bytes) -> None:
    text = data.decode("utf-8", errors="strict") if _is_utf8(data) else ""
    if not text:
        raise Validation("The SVG file must be UTF-8 encoded", fields={"file": "invalid"})
    lowered = text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise Validation("The SVG file must not contain a DOCTYPE or entities", fields={"file": "unsafe"})
    try:
        root = ET.fromstring(text)  # noqa: S314 - DOCTYPE/entities rejected above; stdlib expat caps expansion
    except ET.ParseError as exc:
        raise Validation("The SVG file could not be parsed", fields={"file": "invalid"}) from exc
    if root.tag.split("}")[-1].lower() != "svg":
        raise Validation("The file is not an SVG image", fields={"file": "invalid"})
    for el in root.iter():
        tag = el.tag.split("}")[-1].lower()
        if tag in _FORBIDDEN_TAGS:
            raise Validation(f"The SVG file contains a <{tag}> element, which is not allowed",
                             fields={"file": "unsafe"})
        for attr, value in el.attrib.items():
            name = attr.split("}")[-1].lower()
            v = value.strip().lower()
            if name.startswith("on"):
                raise Validation("The SVG file contains event handlers, which are not allowed", fields={"file": "unsafe"})
            if (attr in _HREF_ATTRS or name == "href") and not (v.startswith("#") or v.startswith("data:image/")):
                raise Validation("The SVG file links to external resources, which is not allowed",
                                 fields={"file": "unsafe"})
            if name == "style" and ("url(" in v or "expression(" in v or "@import" in v):
                raise Validation("The SVG file contains external style references, which are not allowed",
                                 fields={"file": "unsafe"})
        if tag == "style" and el.text and re.search(r"url\s*\(|@import", el.text, re.I):
            raise Validation("The SVG file contains external style references, which are not allowed",
                             fields={"file": "unsafe"})


def _is_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def save_logo(variant: str, upload: FileStorage) -> dict[str, Any]:
    if variant not in VARIANTS:
        raise NotFound("Unknown logo variant")
    data = upload.read()
    if not data:
        raise Validation("The file is empty", fields={"file": "empty"})
    if len(data) > MAX_LOGO_BYTES:
        raise Validation("The logo must be smaller than 512 KB", fields={"file": "too_large"})
    ext = _sniff(data)
    if ext == "svg":
        _check_svg(data)
    delete_logo(variant, missing_ok=True)
    target = branding_dir() / f"logo-{variant}.{ext}"
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(target)
    return info()


def delete_logo(variant: str, missing_ok: bool = False) -> dict[str, Any]:
    if variant not in VARIANTS:
        raise NotFound("Unknown logo variant")
    found = False
    for ext in MIME:
        p = branding_dir() / f"logo-{variant}.{ext}"
        if p.is_file():
            p.unlink()
            found = True
    if not found and not missing_ok:
        raise NotFound("No custom logo uploaded")
    return info()


def set_accent(accent: str | None) -> dict[str, Any]:
    settings_svc.update({"brand_accent": (accent or "").strip().lower()})
    return info()
