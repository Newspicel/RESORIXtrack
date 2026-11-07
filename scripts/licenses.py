#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Third-party license inventory and policy check.

    .venv/bin/python scripts/licenses.py            print the inventory
    .venv/bin/python scripts/licenses.py --write    update the generated tables in docs/third-party-licenses.md
    .venv/bin/python scripts/licenses.py --check    fail when a dependency has an unknown or disallowed license,
                                                    or when the document is out of date (run in CI)

Backend packages come from backend/requirements.lock (what the Docker image installs); their license from the
installed metadata. Frontend packages come from frontend/package-lock.json (runtime dependency tree only, i.e.
everything that may end up in the built pages) with the license from node_modules/<pkg>/package.json.
"""

from __future__ import annotations

import importlib.metadata as md
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "third-party-licenses.md"
START, END = "<!-- generated:start -->", "<!-- generated:end -->"

# Permissive or weak-copyleft licenses that are compatible with AGPL-3.0 and impose no obligations beyond keeping
# the notices (which ship with the packages). Anything else must be reviewed by a human before it is allowed here.
ALLOWED = {
    "MIT", "MIT-0", "MIT-CMU", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "BSD", "Apache-2.0", "PSF-2.0",
    "Python-2.0", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "OFL-1.1", "Zlib", "MPL-2.0", "MPL-1.1",
    "LGPL-2.1-or-later", "LGPL-3.0-or-later", "CC-BY-4.0",
}
# Build-time only packages that are pulled into the runtime tree by Astro/Vite but never shipped to browsers.
BUILD_ONLY = {"lightningcss", "caniuse-lite", "browserslist", "esbuild", "rollup", "vite", "sass", "postcss"}

CLASSIFIER_MAP = {
    "MIT License": "MIT", "BSD License": "BSD-3-Clause", "Apache Software License": "Apache-2.0",
    "Python Software Foundation License": "PSF-2.0", "Mozilla Public License 1.1 (MPL 1.1)": "MPL-1.1",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0", "ISC License (ISCL)": "ISC",
    "GNU Lesser General Public License v2 or later (LGPLv2+)": "LGPL-2.1-or-later",
    "GNU General Public License v2 or later (GPLv2+)": "GPL-2.0-or-later",
    "GNU Lesser General Public License v3 or later (LGPLv3+)": "LGPL-3.0-or-later",
}
TEXT_MAP = {"MIT License": "MIT", "BSD License": "BSD-3-Clause", "Dual License": "Apache-2.0 OR BSD-3-Clause",
            "Apache 2.0": "Apache-2.0", "Apache License 2.0": "Apache-2.0", "BSD-3": "BSD-3-Clause"}


def backend_packages() -> list[tuple[str, str, str]]:
    """Name and version come from requirements.lock (what the Docker image installs); only the license is read
    from the installed metadata. So the inventory never depends on what a development environment happens
    to have installed."""
    lock = (ROOT / "backend" / "requirements.lock").read_text()
    pins = dict(re.findall(r"^([A-Za-z0-9_.\-]+)==([^\s\\]+)", lock, re.M))
    rows = []
    for name in sorted(pins, key=str.lower):
        version = pins[name]
        try:
            dist = md.distribution(name)
        except md.PackageNotFoundError:
            rows.append((name, version, "NOT INSTALLED")); continue
        if dist.version != version:
            print(f"note: {name} {dist.version} is installed but the lock pins {version}; run scripts/setup.sh to sync",
                  file=sys.stderr)
        meta = dist.metadata
        lic = meta.get("License-Expression") or ""
        if not lic:
            classifiers = [c.split("::")[-1].strip() for c in (meta.get_all("Classifier") or []) if c.startswith("License ::")]
            lic = " OR ".join(CLASSIFIER_MAP.get(c, c) for c in classifiers)
        if not lic:
            raw = (meta.get("License") or "").strip()
            lic = TEXT_MAP.get(raw, raw.splitlines()[0][:40] if raw else "")
        rows.append((name, version, lic or "UNKNOWN"))
    return rows


def frontend_packages() -> list[tuple[str, str, str]]:
    lock = json.loads((ROOT / "frontend" / "package-lock.json").read_text())
    rows: dict[tuple[str, str], str] = {}
    for path, info in lock.get("packages", {}).items():
        if not path or info.get("dev") or info.get("extraneous"):
            continue
        name = path.split("node_modules/")[-1]
        version = info.get("version", "?")
        pj = ROOT / "frontend" / path / "package.json"
        if not pj.exists() and info.get("optional"):
            continue  # optional platform-specific build (e.g. lightningcss-win32-*) that is not installed here
        lic = "NOT INSTALLED"
        if pj.exists():
            data = json.loads(pj.read_text())
            raw = data.get("license") or data.get("licenses") or "UNKNOWN"
            if isinstance(raw, list):
                raw = " OR ".join(x.get("type", "?") if isinstance(x, dict) else str(x) for x in raw)
            elif isinstance(raw, dict):
                raw = raw.get("type", "UNKNOWN")
            lic = str(raw).strip("()")
        rows[(name, version)] = lic
    return sorted(((n, v, lic) for (n, v), lic in rows.items()), key=lambda r: r[0].lower())


def allowed(expr: str) -> bool:
    expr = expr.strip().strip("()")
    if " OR " in expr:
        return any(allowed(p) for p in expr.split(" OR "))
    if " AND " in expr:
        return all(allowed(p) for p in expr.split(" AND "))
    return expr.strip() in ALLOWED


def render() -> str:
    be, fe = backend_packages(), frontend_packages()
    out = [START, "", f"_{len(be)} backend packages (requirements.lock) and {len(fe)} frontend packages (runtime tree of package-lock.json)._", ""]
    out += ["### Backend (Python, installed in the Docker image)", "", "| Package | Version | License |", "|---|---|---|"]
    out += [f"| {n} | {v} | {lic} |" for n, v, lic in be]
    out += ["", "### Frontend (JavaScript, runtime dependency tree)", "",
            "Packages marked *build only* are pulled in by Astro/Vite for the build and are not part of the pages served to browsers.", "",
            "| Package | Version | License |", "|---|---|---|"]
    out += [f"| {n} | {v} | {lic}{' (build only)' if n in BUILD_ONLY else ''} |" for n, v, lic in fe]
    out += ["", END]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    body = render()
    problems = [f"{n} {v}: {lic}" for n, v, lic in backend_packages() + frontend_packages() if not allowed(lic)]
    if "--write" in argv:
        doc = DOC.read_text()
        i, j = doc.index(START), doc.index(END) + len(END)
        DOC.write_text(doc[:i] + body + doc[j:])
        print(f"updated {DOC.relative_to(ROOT)}")
    elif "--check" in argv:
        doc = DOC.read_text()
        if body not in doc:
            print("docs/third-party-licenses.md is out of date: run scripts/licenses.py --write", file=sys.stderr)
            return 1
        print("third-party licenses: inventory up to date")
    else:
        print(body)
    if problems:
        print("licenses needing review (not in the allow-list):", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1
    print("third-party licenses: all within the allow-list")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
