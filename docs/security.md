# Security

This page describes how RESORIXtrack protects employee data, what the operator has to do to keep it that way, and where the limits are. It is written for the person who installs and runs RESORIXtrack. Reporting a vulnerability: see [SECURITY.md](../SECURITY.md).

## Threat model in one paragraph

RESORIXtrack stores personal data (working hours, absences, sick notes) for everyone in a company. It is intended for **internal hosting on the company network or behind a VPN** and is not hardened for exposure to the public internet; you run it at your own risk and RESORIX AG accepts no liability for any damage. The attackers we design against are: strangers on the internet (credential stuffing, scanning, abusing the first-run setup), a malicious or careless employee (reading colleagues' data, changing their own history after a month was signed off), a stolen laptop or session, and someone who obtains a copy of the database or a backup. We do **not** try to protect against an attacker who controls the server itself; for that, standard server hygiene (updates, SSH keys, firewall, disk encryption) applies.

## Accounts and passwords

- Passwords are hashed with **Argon2id** (RFC 9106 parameters: 64 MiB memory, 3 iterations, 4 lanes), salted and never stored or logged in clear text. Hashes are upgraded automatically on sign-in when parameters change.
- Password policy: at least 10 characters, not a common password, not containing the local part of the email address.
- Unknown-user and wrong-password errors are identical and take the same time (a dummy hash is computed), so account existence can't be probed.
- **Sign-in throttling** per email+IP (8 failures in 15 minutes by default), plus wider ceilings per email (5×) and per IP (4×) so one attacker can't lock a user out from everywhere, and a distributed spray against one account is still stopped.
- Password-reset emails are limited separately (3 per address and 20 per IP per hour) and never count as failed sign-ins.
- Invitation links are valid for 72 hours, reset links for 1 hour; both are single-use, stored only as SHA-256 hashes, and carry the token in the URL **fragment** so it never reaches server access logs.
- New passwords are also checked against **Have I Been Pwned** (k-anonymity: only the first five characters of the SHA-1 hash leave the server; disable with `PWNED_PASSWORDS_CHECK=false`; fails open when the service is unreachable).
- **Two-factor authentication (TOTP)** can be enabled by every person under Profile & security (and required for administrators or for everyone): a 6-digit code from an authenticator app at sign-in, eight single-use recovery codes, replay protection within the 30-second step, secret encrypted at rest. Administrators can be required to use it (Settings → General); an administrator can reset it for a person who lost their phone (password confirmation, logged). The password step and the code step are throttled together.
- Administrators can set a user's password directly (for people without email). They must confirm their *own* password to do so; the user is signed out everywhere and notified.
- `flask resorixtrack set-password --email …` does the same from the server console.

## Sessions and CSRF

- Sessions are **server-side**: the browser only holds a random 256-bit token, stored hashed. Each person sees their signed-in devices in the profile and can sign any of them out.
- Cookies are `HttpOnly`, `Secure` (over HTTPS), `SameSite=Lax`, and use the `__Host-` prefix so they are bound to the exact host.
- "Keep me signed in" slides for the configured number of days (30 by default) and is capped at an **absolute lifetime of 90 days**, however often it is used. Without it, a session ends after 12 hours of inactivity.
- Every state-changing request from the browser must carry the CSRF token (double-submit cookie plus a server-stored synchronizer token, compared in constant time).
- Changing or resetting a password, an administrator setting a password, changing the email address, or deactivating an account ends **all** sessions and revokes **all** API tokens of that user.

## API tokens

- Personal access tokens (`rt_…`) are created in the profile, require the account password, are stored hashed, and are **scoped** (`clock`, `entries:read`, `entries:write`, `absences:read`, `absences:write`, `reports:read`, `admin`).
- Tokens always expire: 90 days by default, 365 at most, 90 at most for `admin` scope.
- Routes that manage the account itself (sessions, tokens, password, profile) are session-only and refuse tokens, so a token on a desktop can never escalate to full account control.
- Tokens are fully **audited**: creation and revocation go to the audit log (with scopes, expiry, who and why), every call is counted with the last-used IP, and the first use per day and IP is written to the sign-in log. Administrators see every token in the company (*Backups & logs → API tokens*), can revoke any of them, and can switch personal tokens off company-wide.

## Roles

| | Sees time data of | Can |
|---|---|---|
| **Employee** | themselves | clock, edit own entries (logged), request absences, log work |
| **Team lead / deputy** (per team, optionally for a period) | members of their teams | correct entries, approve, record absences, sign off months, manage team projects, name deputies |
| **HR** (capability) | everyone | reports for all, sign off anyone incl. leads, reopen months, export personal data, integrity check |
| **Administrator** (role) | nobody (own data only) | users, teams, roles and capabilities, settings, holidays, branding, backups, sign-in log, token overview, anonymisation |
| **Projects** (capability) | – | create and maintain all projects |

Administrators therefore run the system without seeing anyone's hours; a company grants the HR capability to the people who do. Several administrators, several leads per team and deputies ("Stellvertreter") with a validity period are all supported. Backups contain the whole database but are encrypted with the server's backup password; still, keep downloads to trusted operators and the password out of their reach where appropriate.

## Authorization and data isolation

- Every endpoint checks permissions on the server as described above. Administrators without HR get `404`/`403` on every time-data endpoint, and the change log hides time entities from them.
- Objects outside the caller's scope answer `404`, so IDs can't be enumerated to learn who exists.
- In the team calendar, colleagues see only *that* someone is absent; sick leave is anonymised and notes are hidden.
- An automated test (`backend/tests/test_isolation.py`) calls **every** API route as an employee (session and token) and as a lead of another team and asserts that no response contains other people's private data and nothing of theirs changed.

## Month sign-off: tamper evidence

After a team lead or administrator signs off a month, that person's entries, absences and adjustments in that period are read-only for everyone, enforced on four levels: UI, service layer, **SQLite triggers** (no raw SQL can change them either), and an **HMAC-SHA256 seal chain** over a SHA-256 fingerprint of the data, keyed with `SIGNOFF_KEY` (defaults to `SECRET_KEY`). The integrity check (Team → Month sign-off → Integrity check) detects changed rows, forged or deleted sign-offs, missing triggers, and rule changes that altered a signed month's figures retroactively.

Keep `SIGNOFF_KEY` separate from your backups: anyone with both the database file and the key could forge seals.

## First-run setup

The setup wizard creates the first administrator. Until that account exists, the wizard requires a **one-time setup code** that is printed to the server log on start (`docker compose logs app`) and can be regenerated with `flask resorixtrack setup-code`. Without it, a stranger who found the fresh installation (for example through certificate-transparency logs) could claim it.

## Web application hardening

- **Content-Security-Policy** without `unsafe-inline` for scripts: only the app's own files plus SHA-256 hashes of the two bootstrap snippets the frontend build emits; no third-party CDNs (the API documentation UI is vendored into the image). Also `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, HSTS over TLS.
- The interactive API docs and the OpenAPI spec require sign-in.
- Post-login redirects (`?next=`) are restricted to same-origin paths.
- All free-text input rejects control characters (prevents mail-header injection); email addresses are validated strictly; date ranges are bounded.
- CSV/XLSX exports neutralise cells starting with `= + - @` so a note can't become a spreadsheet formula.
- **Uploads** (sick notes, logos): type is detected from content, not the file name; size and count are limited; files are stored under random names outside the web root and served with `nosniff` and a `default-src 'none'` CSP. Uploaded **SVG logos** are parsed and rejected if they contain scripts, event handlers, external references or a DOCTYPE, and are additionally served with a sandboxing CSP.
- PDF rendering (WeasyPrint) is restricted to local static files; it can't fetch URLs.
- Error responses never include stack traces; database errors are logged without bound parameters.

## Deployment

The Compose stack is hardened by default:

- The app port is bound to **127.0.0.1** unless you set `RESORIXTRACK_BIND`; the recommended deployment is the `tls` profile with the built-in Caddy (automatic Let's Encrypt), or your own reverse proxy.
- `X-Forwarded-*` headers are only trusted when `TRUSTED_PROXIES` is at least 1 (set it to the number of proxies in front of the app; 0 when reached directly). Otherwise anyone could spoof client IPs and bypass per-IP throttling.
- Containers run as an unprivileged user with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, PID and memory limits.
- The application refuses to start with the placeholder `SECRET_KEY` from `.env.example`, or with a short or low-entropy key.
- Secrets can be provided as files (`SECRET_KEY_FILE`, `SIGNOFF_KEY_FILE`, `SMTP_PASSWORD_FILE`) for Docker/Compose secrets.
- SMTP credentials are never sent over an unencrypted connection unless you explicitly set `SMTP_ALLOW_PLAINTEXT_AUTH=true`.
- Python dependencies are installed from a hash-pinned lock file (`backend/requirements.lock`); frontend dependencies from `package-lock.json` with `npm ci`.

## Logs and personal data

- The **sign-in log** records every attempt (success, wrong password, unknown address, disabled account, throttled) with IP and device. Unknown addresses are stored masked (`an***@example.com`) because people regularly type a password into the email field. Retention is configurable (365 days by default); each person sees their own attempts in the profile.
- The **audit log** (`revisions` table) is append-only at database level and records who changed what, when and why, for all time-relevant data.
- Access logs (gunicorn) contain the request path but never the query string, so no tokens.
- Soft-deleted records are kept for the statutory record-keeping period. `flask resorixtrack purge-attachments --older-than 365` deletes the *files* of removed documents and of documents on cancelled or declined absences; the records and checksums stay.
- Deleted documents are not included in backups.
- Emails contain no remote resources: the company logo is embedded as an inline attachment, there are no web fonts, scripts or tracking pixels, and links are plain links to your own installation. A test enforces this for every template.

## Data-protection requests

- **Access request / export:** every person can download everything stored about them (Profile & security → *Download my data*, JSON); administrators can export any person (Employees → Edit → *Export data*).
- **Anonymisation of former employees:** Employees → Edit → *Anonymise…* (inactive accounts, password confirmation) or `flask resorixtrack anonymize --email …` (enforces a retention period, 5 years by default). Name and email become placeholders, documents are deleted, logs/sessions/tokens/notifications are removed, and the name is scrubbed from the change history; working-time records remain for the statutory period (signed-off months stay immutable). The action is logged.

## What RESORIXtrack does not do (yet)

- No SSO (OIDC/SAML). Keep administrator accounts to the few people who need them, enable two-factor authentication for them and use strong passphrases.
- No encryption of the live database at rest (backups are encrypted); use full-disk encryption on the server.

## Checklist for operators

1. Random `SECRET_KEY` (and ideally a separate `SIGNOFF_KEY`) and a strong `BACKUP_PASSWORD`, `.env` readable only by root; both in your password manager.
2. HTTPS everywhere; `SESSION_COOKIE_SECURE=true` (the default); `TRUSTED_PROXIES` matching your setup.
3. App port not exposed publicly (default `127.0.0.1`), firewall for the rest.
4. SMTP with STARTTLS or TLS.
5. Two-factor authentication for every administrator, or for everyone (Settings → General → require it).
6. Encrypted backups copied off the server regularly and a restore tested once ([backup-restore.md](backup-restore.md)).
7. Keep the image updated; migrations run automatically and make a backup first.
8. Review the sign-in log and the admin accounts from time to time.
