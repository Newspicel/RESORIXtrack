# Installation

This guide is for the person who runs RESORIXtrack on a server. It takes about 20 minutes.

## Requirements

- A Linux server (1 vCPU, 1 GB RAM and a few GB of disk are plenty for 50 people) with **Docker 24+** and the Compose plugin.
- A DNS name for the installation, e.g. `time.example.com`, pointing at the server.
- An **SMTP account** for sending email (invitations, password resets, notifications). Any provider works; see the table below.
- Ports 80 and 443 open if you use the built-in HTTPS proxy.

## 1. Get the code and configure

```bash
git clone https://github.com/RESORIX-AG/RESORIXtrack.git resorixtrack   # or download the ZIP from GitHub and unpack it
cd resorixtrack
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # -> SECRET_KEY
```

Edit `.env`:

| Variable | What to put |
|---|---|
| `SECRET_KEY` | The random string you just generated. Never reuse it elsewhere. The app refuses the placeholder. |
| `BASE_URL` | `https://time.example.com` – used in email links |
| `RESORIXTRACK_DOMAIN` | `time.example.com` – for the built-in HTTPS proxy |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Your mail provider (see below) |
| `TRUSTED_PROXIES` | `1` with the built-in Caddy or one proxy of your own; `0` if browsers reach the app directly |

Everything else can stay at its default. The full list is in the [configuration reference](#configuration-reference).

## 2. Start

**Recommended: built-in HTTPS** (Caddy obtains and renews a Let's Encrypt certificate automatically):

```bash
docker compose --profile tls up -d --build
```

**Behind your own reverse proxy** (Traefik, nginx, HAProxy, …): the app listens on `127.0.0.1:8080` only.

```bash
docker compose up -d --build
```

Forward `https://time.example.com` to `http://127.0.0.1:8080` (or `app:8080` on a shared Docker network), send `X-Forwarded-For` and `X-Forwarded-Proto`, keep `TRUSTED_PROXIES=1`, allow request bodies of at least 12 MB (document uploads), and terminate TLS at the proxy.

Check that everything is up:

```bash
docker compose ps                      # app and worker "healthy" / "running"
curl -s https://time.example.com/api/health
```

## 3. First-run setup

Open `https://time.example.com`. The setup wizard asks for:

1. **Company**: name and timezone.
2. **Working time**: full-time weekly hours, vacation days per year, and the public-holiday calendar (built-in Swiss presets, or skip and import later).
3. **Your administrator account**: name, email, password, your employment start, and the **setup code**.
   This first administrator also receives the **HR** and **Projects** capabilities (all time data, sign-offs, projects), so you can run a small company alone; hand them to other people later under Administration → Employees.

The setup code proves you control the server. It is printed when the app starts:

```bash
docker compose logs app | grep -A4 "first-run setup"
# or generate a fresh one:
docker compose exec app flask resorixtrack setup-code
```

After the wizard you land on the dashboard with a **Getting started** checklist. Continue with the [administrator guide](admin-guide.md).

## Email (SMTP)

RESORIXtrack sends: invitations, password resets and change notices, absence requests and decisions, sick reports, corrections and disputes, clock-out reminders, month sign-off notices. Emails are localised (English, German, French) and carry your logo.

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURITY` | Notes |
|---|---|---|---|---|
| Microsoft 365 | `smtp.office365.com` | 587 | `starttls` | mailbox user + password, SMTP AUTH enabled for that mailbox |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | `starttls` | an *app password*, not the account password |
| Infomaniak | `mail.infomaniak.com` | 587 | `starttls` | |
| Any provider with implicit TLS | … | 465 | `ssl` | |
| Local relay without auth | your relay | 25 | `none` | leave `SMTP_USER` empty |

Passwords are never sent over an unencrypted connection (`SMTP_SECURITY=none` with a user set is refused unless `SMTP_ALLOW_PLAINTEXT_AUTH=true`). Verify your settings with **Administration → Settings → Email → Send test email**.

Without SMTP, RESORIXtrack still works: administrators set passwords for employees directly (**Employees → Edit → Set password**) and the forgot-password page tells users to contact an administrator.

## Updating

```bash
git pull                       # or pull the new image
docker compose --profile tls up -d --build   # (without --profile tls if you use your own proxy)
```

On start, the `app` container runs `flask resorixtrack migrate`:

1. If schema migrations are pending, it first writes an encrypted backup to `/data/backups/…-premigrate.zip.enc`.
2. It applies **all** pending migrations in order – skipping several releases is fine.
3. It refuses to start if the database is *newer* than the application (accidental downgrade); your data is untouched.

The `worker` waits until the schema is current. Release notes are in [CHANGELOG.md](../CHANGELOG.md).

## Where the data is

Everything is in the Docker volume `resorixtrack-data` (`/data` in the containers): the SQLite database, uploaded documents, logos and backups. See [backup-restore.md](backup-restore.md) – set up an off-site copy right after installing.

**Intended use:** RESORIXtrack is meant for the internal company network or a VPN, not for the public internet (see [security.md](security.md)).

## Configuration reference

All settings are environment variables in `.env`. Secrets can alternatively be read from files by appending `_FILE` to the name (`SECRET_KEY_FILE`, `SIGNOFF_KEY_FILE`, `BACKUP_PASSWORD_FILE`, `SMTP_PASSWORD_FILE`), which works with Docker/Compose secrets.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | **required** | ≥ 32 random characters; signs sessions and (by default) month sign-offs |
| `BACKUP_PASSWORD` | **required** | ≥ 12 characters; every backup is encrypted with it (Argon2id + ChaCha20-Poly1305). Keep it in your password manager |
| `SIGNOFF_KEY` | = `SECRET_KEY` | Separate key for sign-off seals. Recommended; keep it away from your backups |
| `BASE_URL` | `http://localhost:8080` | Public URL used in emails |
| `RESORIXTRACK_DOMAIN` | `localhost` | Domain for the built-in Caddy (`--profile tls`) |
| `RESORIXTRACK_BIND` / `RESORIXTRACK_PORT` | `127.0.0.1` / `8080` | Where the app port is published on the host |
| `TRUSTED_PROXIES` | `0` | Number of reverse proxies in front of the app; forwarded headers are ignored at `0` |
| `SESSION_COOKIE_SECURE` | `true` | Cookies only over HTTPS. `false` **only** for a plain-HTTP test on a trusted network |
| `SESSION_SHORT_IDLE_HOURS` | `12` | Idle timeout without "keep me signed in" |
| `SESSION_ABSOLUTE_DAYS` | `90` | Hard cap for any session |
| `LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_MINUTES` | `8` / `15` | Sign-in throttling per email+IP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | – | Mail server (see above) |
| `SMTP_ALLOW_PLAINTEXT_AUTH` | `false` | Allow a password over an unencrypted SMTP connection |
| `ATTACHMENT_MAX_MB` | `10` | Maximum document upload size |
| `BACKUP_KEEP` | `14` | Nightly backups to keep |
| `RESORIXTRACK_MEM_LIMIT` / `RESORIXTRACK_WORKER_MEM_LIMIT` | `1g` / `512m` | Container memory limits |
| `WEB_WORKERS` / `WEB_THREADS` / `WEB_TIMEOUT` | `2` / `4` / `120` | gunicorn sizing |
| `SETUP_CODE_REQUIRED` | `true` | Require the one-time code in the setup wizard |
| `PWNED_PASSWORDS_CHECK` | `true` | Check new passwords against Have I Been Pwned (k-anonymity: only a 5-character hash prefix is sent; fails open when offline) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning` |
| `SOURCE_URL` | `https://github.com/RESORIX-AG/RESORIXtrack` | "Source code" link on the sign-in page. Set it to your repository if you modified RESORIXtrack (AGPL section 13) |
| `RESORIXTRACK_IMAGE` | `resorixtrack:latest` | Image name/tag to run |

Business rules (working time, holidays, absence types, lead permissions, session length, log retention, branding) are configured in the web UI under **Administration → Settings**.

## Troubleshooting

- **Sign-in works but every action fails, or you are signed out immediately** – you are on plain HTTP with `SESSION_COOKIE_SECURE=true`. Use HTTPS (recommended) or set it to `false` for a test setup.
- **"The setup code is missing or wrong"** – run `docker compose exec app flask resorixtrack setup-code` and use the new code.
- **Wrong client IP in the sign-in log / everybody gets throttled together** – set `TRUSTED_PROXIES` to the number of proxies in front of the app.
- **No emails arrive** – *Send test email* in Settings shows the SMTP error; also `docker compose logs app`.
- **"database is newer than the application"** – you started an older image on a newer database. Use the newer image or restore a matching backup.
- **Uploads fail with 413** – raise the body-size limit on your reverse proxy (12 MB).
- **Container health** – `docker compose ps`, `docker compose logs -f app worker`, `curl localhost:8080/api/health` on the host.
