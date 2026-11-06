# Security policy

**Scope.** RESORIXtrack is intended for internal hosting on a company network or behind a VPN. It is not hardened for exposure to the public internet; reports about such deployments are welcome but out of scope. The software is provided as is, at your own risk, without any liability of RESORIX AG.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private vulnerability reporting (https://github.com/RESORIX-AG/RESORIXtrack/security/advisories/new – "Report a vulnerability" under the Security tab) so the details stay confidential until a fix is available. Describe what you found, how to reproduce it, and which version you tested. If you cannot use GitHub, write to mail@resorix.ch instead. You will get an acknowledgement within a few working days.

## Supported versions

Only the latest release receives security fixes. Updating is a `git pull` / image pull and `docker compose up -d --build`; migrations run automatically and make a backup first.

## What is in scope

Everything in this repository: the backend, the web frontend, the Docker setup and the scripts. Findings about third-party services you may connect (SMTP provider, reverse proxy) are out of scope unless RESORIXtrack misuses them.

## How RESORIXtrack is secured

See [docs/security.md](docs/security.md) for the design (authentication, sessions, isolation, tamper-evident sign-offs, hardening) and the operator checklist.
