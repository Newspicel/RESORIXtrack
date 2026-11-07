# Migration from 1.x

`rt import-v1` copies a v1 database and its documents and logos into a fresh v2 database. It keeps ids, converts formats, verifies every sign-off seal and prints a report. It never writes to the v1 files, so v1 stays ready as a fallback.

v2 never upgrades a v1 database in place. Pointed at one (the same data directory or `DATABASE_PATH`), it refuses to start and leaves the file unchanged; follow the steps below.

## What carries over

| Data | In v2 |
|---|---|
| People, teams, leads, deputies, schedules, entitlements, holidays, absence types, projects, settings | Imported |
| Time entries, absences, adjustments, sign-offs, change log, sign-in log, notifications | Imported |
| Work log | Moved onto the time entries as their project and note (a customer reference joins the note), for months that are not signed off (an entry spanning several items is split, the attendance stays the same). Signed-off months keep their work log rows, because their seals cover them; reports still count them |
| Setting "work log" | Becomes "projects on time entries"; Required now means every work entry has a project | 
| Passwords (Argon2id) | Kept; people sign in with their v1 password |
| Documents, logos | Copied and checked against their SHA-256 |
| Sign-off seals | Verified with the v1 key and kept; v2 sign-offs extend each person's chain |
| Two-factor (TOTP) | Must be enrolled again; asked at next sign-in |
| API tokens | Not migrated (new scopes); create API keys again |
| Sessions, open invitation and reset links | Not migrated; sign in again, send invitations again |
| Setting "stay signed in for" (`session_remember_days`) | Ignored; set `SESSION_REMEMBER_DAYS` in `.env` |

## Before you start

- v1 must run the **latest 1.x release** (the importer accepts schema revisions `0001`, `0002` and `0003`). A pending "clock out later" is carried over and executed by v2.
- Have the v1 `.env` at hand: you need `SIGNOFF_KEY`, or `SECRET_KEY` if `SIGNOFF_KEY` was not set.
- Both versions use the Compose project name `resorixtrack` and the volume `resorixtrack-data`. Install v2 in its **own directory with its own project name** so the v1 volume stays untouched.
- Plan a short downtime. Entries made in v1 after the copy are not imported.

## Steps

The examples assume v1 in `/srv/resorixtrack` and v2 in `/srv/resorixtrack2`.

1. **Back up v1** and copy the archive off the server:
   ```bash
   cd /srv/resorixtrack
   docker compose exec app flask resorixtrack backup
   ```
2. **Stop v1** (keep its volume):
   ```bash
   docker compose stop
   ```
3. **Copy the v1 data** to a host directory (unencrypted; deleted in step 11):
   ```bash
   sudo install -d -m 700 /srv/resorixtrack-v1-data
   docker run --rm -v resorixtrack_resorixtrack-data:/data:ro -v /srv/resorixtrack-v1-data:/out alpine cp -a /data/. /out/
   ```
4. **Install v2** in its own directory and configure `.env` as in [installation.md](installation.md):
   ```bash
   git clone https://github.com/RESORIX-AG/RESORIXtrack.git /srv/resorixtrack2
   cd /srv/resorixtrack2
   cp .env.example .env
   ```
   In `.env` set:
   - `COMPOSE_PROJECT_NAME=resorixtrack2` (separate volume),
   - `SIGNOFF_KEY=` the v1 `SIGNOFF_KEY`, or the v1 `SECRET_KEY` if v1 had none. Keep this value for good: every imported seal is verified with it.
   - `SECRET_KEY` and `BACKUP_PASSWORD`: new values or the v1 ones.
5. **Build** the image: `docker compose build`.
6. **Dry run** (writes nothing):
   ```bash
   docker compose run --rm --no-deps -v /srv/resorixtrack-v1-data:/v1 app rt import-v1 --data /v1 --dry-run
   ```
7. **Read the report.** Row counts per table must match (`MISMATCH` otherwise). It lists:
   - seals verified, and any broken ones (wrong `SIGNOFF_KEY` is the usual cause),
   - missing or changed documents,
   - people who need an invitation (no password yet),
   - people who must create new API keys,
   - people who must enrol two-factor again.

   The import aborts on seal or document problems. `--force` imports anyway and keeps the problems in the report; use it only when you understand them.
8. **Import**:
   ```bash
   docker compose run --rm --no-deps -v /srv/resorixtrack-v1-data:/v1 app rt import-v1 --data /v1
   ```
   If the v2 database already has people, the import refuses; `--force` moves the old database aside first.
9. **Start v2**:
   ```bash
   docker compose --profile tls up -d   # without --profile tls for your own proxy
   ```
10. **Verify**:
    ```bash
    docker compose exec app rt verify-signoffs   # "… sign-offs of … people intact"
    ```
    Sign in, open a few people's time accounts and compare balances with v1. Run **Team → Month sign-off → Integrity check**.
11. **Follow up**: send the invitations from the report (Employees → Access → Resend invitation), tell API users to create new keys, tell people two-factor is asked again. Then delete the plaintext copy:
    ```bash
    sudo rm -rf /srv/resorixtrack-v1-data
    ```
12. Keep the v1 directory, volume and backups until you are sure. Remove them later with `docker compose down -v` in the v1 directory.

## Rollback

v1 data was never modified.

```bash
cd /srv/resorixtrack2 && docker compose down
cd /srv/resorixtrack && docker compose up -d
```

Anything recorded in v2 after the switch is not in v1.

## From a v1 backup

`rt decrypt-backup <file> --out <dir>` writes a v1 archive into a directory that `rt import-v1 --data <dir>` reads; delete the directory afterwards. Or let `rt restore` do it: it detects a v1 archive, decrypts it to a private temporary folder in the container and stops with the `import-v1` command to run. Run both in one container so the decrypted folder disappears with it:

```bash
docker compose run --rm --no-deps -v /path/to/backups:/backups:ro app \
  sh -c 'rt restore /backups/<file>.zip.enc --ask-password; rt import-v1 --data /tmp/resorixtrack-v1-* --dry-run'
```

Check the report, then repeat with the dry run removed. `--ask-password` asks for the v1 backup password; omit it when it equals `BACKUP_PASSWORD`. The temporary folder lives in the container's 256 MB `/tmp`. For larger archives add `-e TMPDIR=/work -v /srv/v1-tmp:/work`, use `--data /work/resorixtrack-v1-*`, and delete `/srv/v1-tmp` afterwards.
