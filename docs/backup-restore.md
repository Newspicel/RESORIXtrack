# Backup and restore

All data of a RESORIXtrack installation lives in one Docker volume, `resorixtrack-data`, mounted at `/data` in the containers:

```
/data/resorixtrack.db      SQLite database (WAL mode): everything except files
/data/attachments/      uploaded documents (sick notes), random file names
/data/branding/         uploaded company logos
/data/backups/          backup archives created by RESORIXtrack
```

Your `.env` file (with `SECRET_KEY`, `SIGNOFF_KEY`, `BACKUP_PASSWORD`, SMTP credentials) lives outside the volume. Keep a copy of it in your password manager: without `BACKUP_PASSWORD` no backup can be restored at all, and without `SECRET_KEY`/`SIGNOFF_KEY` the sign-off seals of a restored database would show as invalid (the data itself is fine).

## What a backup contains

A backup is a file `resorixtrack-YYYYMMDD-HHMMSS[-label].zip.enc`: a ZIP archive, **encrypted** with the server's backup password. Decrypted, the ZIP holds:

- `resorixtrack.db` – a consistent copy made with SQLite's online backup API, so it is safe to take while people are working;
- `attachments/` – the current (non-deleted) documents, when included;
- `manifest.json` – version, timestamp and options.

### Encryption

- Every backup – nightly, pre-migration, manual, downloaded – is encrypted; no unencrypted archive is ever written to disk. Downloads deliver the encrypted file as is.
- `BACKUP_PASSWORD` in `.env` (or `BACKUP_PASSWORD_FILE`) is **mandatory** (≥ 12 characters); the app refuses to start without it. **Keep it in your password manager**: without it no backup can be opened or restored, and nobody can recover it for you.
- Format "RTBK1": a 256-bit key is derived from the password with **Argon2id** (64 MiB, 3 passes, random 16-byte salt per archive) and the ZIP is encrypted in 1 MiB chunks with **ChaCha20-Poly1305**; the header is authenticated with every chunk and a last-chunk flag makes truncation detectable. A wrong password or any modification is rejected.
- Changing the password affects new backups only. Old archives still need the password they were made with – keep the old one until those archives are rotated away, and use `--ask-password` to restore them.
- Decrypting outside RESORIXtrack: `scripts/decrypt-backup.py` (needs `pip install cryptography argon2-cffi`), or `flask resorixtrack decrypt-backup <file> -o plain.zip` in the container.

## How backups are created

| Trigger | Where | Notes |
|---|---|---|
| **Nightly** at 02:00 (company timezone), by the `worker` container | `/data/backups/…-auto.zip.enc` | includes documents; the last `BACKUP_KEEP` (default 14) are kept |
| **Before every schema migration** on start of a new version | `/data/backups/…-premigrate.zip.enc` | database only; never rotated automatically |
| **Administration → Backups & logs → Create backup** | `/data/backups/` | choose whether to include documents |
| **Download a fresh backup** (same page) | your browser | creates and downloads in one step |
| `make backup` on the Docker host | `./backups/` | runs `flask resorixtrack backup` in the container and copies the file out |
| API: `POST /api/v1/admin/backups`, `GET /api/v1/admin/backups`, `GET /api/v1/admin/backups/<name>`, `POST /api/v1/admin/backups/download` | scripts | needs an `admin`-scoped token or an admin session |

Manual and pre-migration backups are never deleted automatically; remove old ones in the web UI or on disk.

## Off-site copies

A backup on the same disk as the database only protects against mistakes, not against disk failure, ransomware or a lost server. Copy backups elsewhere at least daily. Two simple approaches:

**A. Pull the latest backup with a cron job on another machine**

```bash
# on the backup host; needs SSH access to the Docker host
0 3 * * * ssh resorixtrack-host 'docker compose -f /srv/resorixtrack/docker-compose.yml exec -T app sh -c "ls -t /data/backups/*-auto.zip.enc | head -1 | xargs cat"' > /backups/resorixtrack-$(date +\%F).zip.enc
```

**B. Sync the backups folder with your existing backup tool** (restic, borg, rclone, …)

```bash
docker run --rm -v resorixtrack_resorixtrack-data:/data:ro -v /srv/offsite:/out alpine \
  sh -c 'cp /data/backups/*-auto.zip.enc /out/'
```

The archives are already encrypted, so any destination will do – as long as the backup password is stored somewhere else (never next to the backups).

## Restore

Restoring replaces the database and the documents with the content of a backup. The current database is kept as a safety copy.

```bash
make restore f=backups/resorixtrack-20261105-020000-auto.zip.enc
```

The script stops the stack, mounts the archive into a one-off container, runs `flask resorixtrack restore` (which decrypts with `BACKUP_PASSWORD` from `.env`), and starts everything again. For an archive made with an earlier password, run the manual command below with `--ask-password`. Migrations run automatically on start, so a backup from an **older** version restores fine; a backup from a **newer** version is refused ("database is newer than the application") – install the matching version first.

Manual restore without the script:

```bash
docker compose stop
docker compose run --rm --no-deps app flask resorixtrack restore /data/backups/<file>.zip.enc --yes   # add --ask-password for an older password
docker compose up -d
```

After a restore:

1. Sign in and check **Administration → Backups & logs** – the backup list and the audit log should look as expected.
2. Run the **integrity check** under Team → Month sign-off (as an administrator). All sign-offs must be "intact". If they show "seal invalid", the `SIGNOFF_KEY`/`SECRET_KEY` differs from the one used when they were signed.
3. Tell your team if entries made after the backup time have to be re-entered.

## Moving to another server

1. On the old server: `make backup` (or download a fresh backup), and copy `.env` (it holds the backup password).
2. On the new server: install RESORIXtrack as described in [installation.md](installation.md), using the **same `.env`** (at least the same `SECRET_KEY` and `SIGNOFF_KEY`), start it once so the volume exists, then restore the backup as above.
3. Switch DNS.

## Test your restore

Once a quarter, restore the latest backup into a throwaway stack and open it:

```bash
RESORIXTRACK_ENV_FILE=.env.test RESORIXTRACK_PORT=18080 docker compose -p resorixtrack-test up -d
docker compose -p resorixtrack-test run --rm --no-deps app flask resorixtrack restore /data/backups/<file>.zip.enc --yes
# open http://localhost:18080, check, then:
docker compose -p resorixtrack-test down -v
```

(`.env.test` needs the same `BACKUP_PASSWORD`, plus `SESSION_COOKIE_SECURE=false` and `TRUSTED_PROXIES=0` for a plain-HTTP local test.)

## Retention of personal data

- Records are soft-deleted and kept for the statutory period; the change log is append-only.
- `flask resorixtrack purge-attachments --older-than 365` removes the files of deleted documents and of documents on cancelled/declined absences older than a year (the records and checksums remain). Run it from a cron job if you want it automated:
  `docker compose exec app flask resorixtrack purge-attachments --older-than 365`
- Backups never contain deleted documents, but they do contain everything else as of their date. Apply the same retention to your off-site copies.
