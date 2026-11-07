# Security

How RESORIXtrack protects employee data and what the operator must do. Reporting a vulnerability: [SECURITY.md](../SECURITY.md).

## Threat model

RESORIXtrack holds personal data (working hours, absences, sick notes) of a whole company. It is meant for **internal hosting on a company network or behind a VPN**, not for the public internet; you run it at your own risk. Designed against: strangers (credential stuffing, scanning, claiming a fresh installation), a malicious or careless employee (reading colleagues' data, changing signed months), a stolen laptop or session, a stolen database copy or backup. Not designed against an attacker who controls the server; use standard server hygiene.

## Roles

| | Sees time data of | Can |
|---|---|---|
| **Employee** | self | clock, edit own entries (logged), request absences, work log |
| **Team lead / deputy** (per team, optionally for a period) | members of their teams | correct entries, approve, record absences, sign off, team projects, name deputies |
| **HR** (capability) | everyone | company reports, sign off anyone, reopen months, data export, integrity check |
| **Administrator** (role) | nobody (own data only) | people, teams, roles, settings, holidays, branding, backups, logs, anonymisation |
| **Projects** (capability) | nobody | create and maintain all projects |

## Isolation

- Every server function and REST endpoint checks permissions in the service layer (`src/server/services/permissions.ts`).
- Records outside the caller's scope answer **404**, so ids cannot be probed.
- Team calendars show "Absent" for sick leave; notes and documents only reach the person, their leads and HR.
- `src/server/isolation.test.ts` calls every server function and REST endpoint as each persona with other people's ids and fails on any leak or foreign write; API keys are checked against owner and scopes. A new server function fails the test until it is classified.

## Passwords

- **Argon2id** (64 MiB, 3 iterations, 4 lanes; v1 hashes work unchanged). Plaintext is never stored or logged.
- Policy: 10 to 256 characters, not a common password, not containing the email name.
- **Have I Been Pwned** check for new passwords: only the first 5 characters of the SHA-1 hash leave the server; fails open; `PWNED_PASSWORDS_CHECK=false` disables it.
- Throttling by failed attempts: `LOGIN_MAX_FAILURES` (8) per email and IP within `LOGIN_WINDOW_MINUTES` (15), plus ceilings per email (×5) and per IP (×4). Reset emails: 3 per address and 20 per IP per hour. Better Auth rate limits stop floods on top, keyed by the same client address (computed by the server per request from `TRUSTED_PROXIES`; a client cannot choose its bucket).
- Invitation links: 7 days; reset links: 2 hours. Single use, stored hashed, token in the URL fragment (never in access logs).
- Changing or resetting a password ends all sessions and revokes all API keys.

## Two-factor, passkeys, single sign-on

- **TOTP** with 10 single-use backup codes; the secret is encrypted with a key derived from `SECRET_KEY`. Can be required for administrators or everyone (Settings → Security); a passkey or a single sign-on link satisfies the requirement. Administrators can reset it (logged). People imported from v1 enrol again.
- **Passkeys** (WebAuthn), bound to the host of `BASE_URL`. Phishing-resistant, so a passkey sign-in skips TOTP.
- **OpenID Connect** (PKCE): no self-registration; an identity signs in only as an existing active person with the same verified email, or the person already linked to it. Name and email are never taken from the provider. `OIDC_ONLY=true` disables passwords; `rt reset-password` grants one break-glass password sign-in.

## Sessions and CSRF

- **Better Auth** database sessions: the browser holds a random token; sessions can be listed and revoked (Profile → Signed-in devices).
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` with the `__Secure-` prefix when `SESSION_COOKIE_SECURE=true`.
- Lifetime: `SESSION_REMEMBER_DAYS` with "Keep me signed in" (extended while in use); without it the session ends after `SESSION_SHORT_IDLE_HOURS` of inactivity. Every session ends `SESSION_ABSOLUTE_DAYS` after sign-in, however active. Checked on every request (`src/server/session-policy.ts`); an expired session is deleted.
- Deactivating an account ends its sessions, API keys and passkeys.
- **CSRF**: every state-changing request (server functions, `/api/auth`) must come from the app's own origin (TanStack Start CSRF middleware, Better Auth trusted origin = `BASE_URL`). `/api/v1` accepts only API keys, never cookies.

## API keys

- Created under Profile → API keys after confirming the password (people who only use SSO have none to confirm). Shown once, stored hashed, prefix `rt_`.
- Apps obtain a key by signing in (`POST /api/v1/auth/token`: email, password and, with two-factor authentication, the authenticator or a backup code – verified by the same Better Auth two-factor flow as the web, incl. its lockout). Same failure throttle, sign-in log (`token_issued`) and OIDC-only rule as the web sign-in, plus a per-address burst limit; refused while the company requires two-factor authentication the person has not set up. See [api.md](api.md).
- Scopes: `time:read`, `time:write`, `absences:read`, `absences:write`, `reports:read`. A key never exceeds its owner's rights.
- Expire after 30, 90, 180 or 365 days. Per-key rate limit (burst 120, 2 per second). Use count and last use are recorded.
- Account management (password, sessions, keys, profile) is not reachable with a key.
- Settings → Security can switch keys off company-wide.
- Administrators see every key (owner, name, start, scopes, use, expiry) under Backups & logs → API keys, never the key itself, and can revoke one with a reason: the change log records it and the owner is notified.

## Web hardening

- **Content-Security-Policy** with a per-request nonce: `script-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, no third-party origins. Styles allow inline attributes. The API docs page (`/api/v1/docs`, signed in only) allows inline scripts.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, HSTS over HTTPS (also set by Caddy).
- Inputs are validated with zod on the server.
- **Uploads**: type detected from content (PDF, PNG, JPEG, WebP, HEIC), size limited (`ATTACHMENT_MAX_MB`), stored under random names outside the web root, served with `nosniff` and `default-src 'none'`. SVG logos are refused when they contain scripts, event handlers or external references, and served sandboxed.
- Emails contain no remote resources; the logo is an inline attachment.

## Sign-off seals

A signed-off month is read-only on four levels:

1. UI and services refuse changes.
2. **SQLite triggers** refuse inserts, updates and deletes of entries, absences, adjustments, work log, schedules, employment dates and holidays in signed periods, and any change to sign-offs.
3. **Seal**: each sign-off stores a SHA-256 fingerprint of the period's data and an HMAC-SHA256 seal keyed with `sha256("resorixtrack-signoff:" + SIGNOFF_KEY)`.
4. **Chain**: each seal covers the person's previous seal, so deleting or reordering sign-offs is detected.

| Seal version | Canonical form |
|---|---|
| 1 (imported from v1) | Python `json.dumps(sort_keys=True, separators=(",", ":"))`, byte-exact port |
| 2 (v2) | RFC 8785 JSON |

Checks: Team → Month sign-off → Integrity check, `rt verify-signoffs`, and the weekly worker job. Keep `SIGNOFF_KEY` away from backups: whoever has both the database and the key could forge seals.

## Change log

Every change to time data is a revision (who, when, before, after, why, source) in the same transaction. The `revisions` table is append-only (triggers); the only allowed change is scrubbing a person's identity on anonymisation.

## Backups

Always encrypted (Argon2id + ChaCha20-Poly1305), no unencrypted archive on disk. See [backup-restore.md](backup-restore.md).

## Logs and retention

- **Sign-in log**: every attempt with result, IP and device; kept `login_log_retention_days` (Settings → Security, default 365). Each person sees their own.
- Read notifications are deleted after 180 days; expired sessions, links and keys are cleaned up nightly.
- Retention of time data and anonymisation: [compliance.md](compliance.md#data-protection-revdsg-or-328b).

## Deployment

- App port bound to `127.0.0.1` by default; use the `tls` profile or your own proxy.
- Forwarded headers trusted only with `TRUSTED_PROXIES >= 1`: the client address is the entry that many hops from the right of `X-Forwarded-For`, used by the sign-in log, the throttle and the rate limiter alike. With `0` only `X-Real-IP` is read; without it rate limits fall back to one shared bucket.
- Containers: unprivileged user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, PID and memory limits.
- The app refuses to start with the placeholder or a weak `SECRET_KEY`, or without `BACKUP_PASSWORD`.
- Secrets as files (`*_FILE`). SMTP passwords never over an unencrypted connection unless `SMTP_ALLOW_PLAINTEXT_AUTH=true`.
- Dependencies pinned in `pnpm-lock.yaml`; licenses checked by `scripts/licenses.ts`.

## Not covered

- The live database is not encrypted at rest; use full-disk encryption.
- Permits for night and Sunday work are not managed.

## Operator checklist

1. Random `SECRET_KEY`, separate `SIGNOFF_KEY`, strong `BACKUP_PASSWORD`; `.env` mode 600; all three in your password manager.
2. HTTPS; `SESSION_COOKIE_SECURE=true`; `TRUSTED_PROXIES` matches your setup.
3. App port not public; firewall; internal network or VPN.
4. SMTP with STARTTLS or TLS.
5. Two-factor or passkeys required for administrators (or everyone).
6. Off-site copies of the encrypted backups; one restore tested.
7. Keep the image updated.
8. Review the sign-in log and the administrator list now and then.
