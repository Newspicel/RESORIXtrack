# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""`flask resorixtrack ...` management commands."""

from __future__ import annotations

from pathlib import Path

import click
from flask import Flask, current_app
from flask.cli import AppGroup

from .extensions import db

group = AppGroup("resorixtrack", help="RESORIXtrack management commands")


def migration_status() -> dict:
    """Current DB revision vs. the revisions shipped with this version of the app."""
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory
    script = ScriptDirectory.from_config(current_app.extensions["migrate"].migrate.get_config())
    heads = script.get_heads()
    known = {r.revision for r in script.walk_revisions()}
    with db.engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_heads()
        has_tables = bool(db.inspect(conn).get_table_names())
    pending = []
    unknown = [c for c in current if c not in known]
    if not unknown and not set(current) >= set(heads):
        for rev in script.iterate_revisions(heads[0], current[0] if current else "base"):
            pending.append(rev.revision)
    return {"current": list(current), "heads": list(heads), "unknown": unknown,
            "pending": list(reversed(pending)), "has_tables": has_tables}


@group.command("migrate")
@click.option("--no-backup", is_flag=True, help="Skip the automatic pre-migration backup")
@click.option("--check", is_flag=True, help="Only check: exit 0 if the schema is current, 1 otherwise")
def migrate_cmd(no_backup: bool, check: bool = False) -> None:
    """Safely upgrade the database: backup, apply ALL pending migrations in order, seed base data.

    Safe to run on every start and when several versions were skipped.
    """
    from flask_migrate import upgrade

    from .services import absences, backup

    st = migration_status()
    if check:
        ok = not st["unknown"] and not st["pending"] and bool(st["current"])
        click.echo("up to date" if ok else f"pending: {st['pending'] or 'database not initialized'}")
        raise SystemExit(0 if ok else 1)
    if st["unknown"]:
        raise click.ClickException(
            f"The database is at revision {st['unknown']} which this version of RESORIXtrack does not know. "
            "It was probably upgraded by a newer version; downgrading the app is not supported. "
            "Restore a matching backup or install the newer version.")
    if len(st["heads"]) != 1:
        raise click.ClickException(f"Multiple migration heads {st['heads']}; refusing to migrate.")
    if st["pending"]:
        if st["has_tables"] and not no_backup:
            info = backup.create_backup(include_attachments=False, label="premigrate")
            click.echo(f"Pre-migration backup: {info['name']}")
        click.echo(f"Applying {len(st['pending'])} migration(s): {', '.join(st['pending'])}")
        upgrade()
    else:
        click.echo(f"Database schema is up to date ({', '.join(st['current'])}).")
    from . import db_guards

    with db.engine.begin() as conn:
        missing = [n for n, _ in db_guards.TRIGGERS if n not in db_guards.installed(conn)]
        if missing:  # e.g. dropped by a batch (table-rebuild) migration
            db_guards.install(conn)
            click.echo(f"Re-installed {len(missing)} database guard(s): {', '.join(missing)}")
    absences.seed_types()
    db.session.commit()
    from .services import setup_code

    if current_app.config["SETUP_CODE_REQUIRED"]:
        code = setup_code.ensure()
        if code:
            click.echo(setup_code.banner(code))
        elif setup_code.needed():
            click.echo("First-run setup pending. Show the setup code with: flask resorixtrack setup-code")


@group.command("setup-code")
def setup_code_cmd() -> None:
    """Print a fresh one-time code for the first-run setup wizard (only while no user exists)."""
    from .services import setup_code

    if not setup_code.needed():
        raise click.ClickException("Setup is already complete: an account exists. Use create-admin or set-password.")
    click.echo(setup_code.banner(setup_code.generate()))


@group.command("set-password")
@click.option("--email", required=True)
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
def set_password_cmd(email: str, password: str) -> None:
    """Set a user's password from the server (e.g. when no email can be sent). Signs them out everywhere."""
    from .auth import revoke_user_sessions, revoke_user_tokens
    from .models import User
    from .security import hash_password, password_problems
    from .services import users as users_svc
    from .timeutil import utcnow

    u = db.session.scalar(db.select(User).where(User.email == email.strip().lower()))
    if u is None:
        raise click.ClickException("No user with this email")
    problems = password_problems(password, u.email, u.name, online=bool(current_app.config["PWNED_PASSWORDS_CHECK"]))
    if problems:
        raise click.ClickException(f"Weak password: {', '.join(problems)}")
    u.password_hash = hash_password(password)
    u.password_changed_at = utcnow()
    users_svc.invalidate_links(u)
    revoke_user_sessions(u.id)
    revoke_user_tokens(u.id)
    db.session.commit()
    click.echo(f"Password for {u.email} set; all sessions and API tokens were revoked.")


@group.command("anonymize")
@click.option("--email", required=True, help="Email of the deactivated former employee")
@click.option("--retention-days", default=1825, show_default=True,
              help="Minimum days since the employment end (5 years by default, Swiss record-keeping)")
@click.option("--force", is_flag=True, help="Ignore the employment end / retention check")
@click.option("--yes", is_flag=True, help="Do not ask for confirmation")
def anonymize_cmd(email: str, retention_days: int, force: bool, yes: bool) -> None:
    """Irreversibly anonymise a former employee: identity, documents, logs and change-history mentions.
    Working-time records are kept (statutory retention; signed-off months are immutable)."""
    from .models import User
    from .services import privacy

    u = db.session.scalar(db.select(User).where(User.email == email.strip().lower()))
    if u is None:
        raise click.ClickException("No user with this email")
    if not yes:
        click.confirm(f"Anonymise {u.name} <{u.email}> irreversibly?", abort=True)
    result = privacy.anonymize_user(None, u, retention_days=retention_days, force=force)
    db.session.commit()
    click.echo(f"Anonymised user #{result['user_id']}: {result['documents_removed']} document(s) removed, "
               f"{result['history_entries_scrubbed']} history entries scrubbed.")


@group.command("purge-attachments")
@click.option("--older-than", "days", default=365, show_default=True,
              help="Files of deleted documents and of closed absences older than this many days are removed")
@click.option("--dry-run", is_flag=True)
def purge_attachments_cmd(days: int, dry_run: bool) -> None:
    """Delete stored document files (sick notes) that are no longer needed. The records stay (with
    their checksum) so the change history remains complete."""
    from .services import absences

    removed = absences.purge_attachments(days, dry_run=dry_run)
    db.session.commit()
    click.echo(f"{'Would remove' if dry_run else 'Removed'} {removed} file(s).")


@group.command("init-db")
@click.pass_context
def init_db(ctx: click.Context) -> None:
    """Alias for `migrate`."""
    ctx.invoke(migrate_cmd, no_backup=False, check=False)


@group.command("create-admin")
@click.option("--email", required=True)
@click.option("--name", required=True)
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
def create_admin(email: str, name: str, password: str) -> None:
    """Create an administrator account."""
    from .security import password_problems
    from .services import absences, users
    from .services import settings as st

    problems = password_problems(password, email, online=bool(current_app.config["PWNED_PASSWORDS_CHECK"]))
    if problems:
        raise click.ClickException(f"Weak password: {', '.join(problems)}")
    absences.seed_types()
    u = users.create_user(None, {"email": email, "name": name, "role": "admin", "capabilities": ["hr", "projects"]},
                          password=password, send_invite=False)
    st.update({"setup_complete": True})
    db.session.commit()
    click.echo(f"Administrator {u.email} created.")


@group.command("install-holidays")
@click.option("--preset", default="ch-fr-fribourg", show_default=True)
@click.option("--default/--no-default", "make_default", default=True, show_default=True)
def install_holidays(preset: str, make_default: bool) -> None:
    """Install a built-in holiday calendar preset."""
    from .services import presets

    if preset not in presets.PRESETS:
        raise click.ClickException(f"Unknown preset. Available: {', '.join(presets.PRESETS)}")
    cal = presets.install_preset(preset, make_default=make_default)
    db.session.commit()
    click.echo(f"Installed '{cal.name}' ({len(cal.holidays)} holidays).")


@group.command("seed-demo")
@click.option("--password", default="demo", show_default=True)
def seed_demo(password: str) -> None:
    """Create demo teams, users and three months of data (development only)."""
    from .demo import seed

    if current_app.config["ENV_NAME"] == "production":
        raise click.ClickException("Refusing to seed demo data in production (set RESORIXTRACK_ENV=development)")
    for line in seed(password):
        click.echo(line)


@group.command("backup")
@click.option("--auto", is_flag=True, help="Mark as automatic backup and rotate old ones")
@click.option("--no-attachments", is_flag=True)
def backup_cmd(auto: bool, no_attachments: bool) -> None:
    """Create an encrypted backup (.zip.enc) in DATA_DIR/backups."""
    from .services import backup

    info = backup.create_backup(include_attachments=not no_attachments, label="auto" if auto else "")
    removed = backup.rotate() if auto else 0
    click.echo(f"Backup written: {info['name']} ({info['size']} bytes); rotated {removed}.")


def _backup_password(ask: bool) -> str:
    if ask:
        return click.prompt("Backup password", hide_input=True)
    pw = current_app.config.get("BACKUP_PASSWORD") or ""
    if not pw:
        raise click.ClickException("BACKUP_PASSWORD is not set; pass --ask-password to type it")
    return pw


@group.command("restore")
@click.argument("archive", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--yes", is_flag=True, help="Do not ask for confirmation")
@click.option("--ask-password", is_flag=True, help="Type the backup password instead of using BACKUP_PASSWORD "
              "(for archives made with an earlier password)")
def restore_cmd(archive: Path, yes: bool, ask_password: bool) -> None:
    """Restore an encrypted backup (.zip.enc). Stop the app first! The current DB is kept as a safety copy."""
    from .services import backup, backup_crypto

    password = _backup_password(ask_password)
    if not yes:
        click.confirm("This replaces the current database. Is the app stopped?", abort=True)
    db.session.remove()
    db.engine.dispose()
    try:
        result = backup.restore(archive, Path(current_app.config["DATA_DIR"]), password=password)
    except backup_crypto.BackupCryptoError as e:
        raise click.ClickException(str(e)) from e
    click.echo(f"Restored backup from {result['manifest'].get('created_at')} "
               f"({result['attachments']} attachments). Run `flask resorixtrack init-db` to apply migrations.")


@group.command("decrypt-backup")
@click.argument("archive", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("-o", "--output", type=click.Path(dir_okay=False, path_type=Path), required=True, help="Plain ZIP to write")
@click.option("--ask-password", is_flag=True, help="Type the backup password instead of using BACKUP_PASSWORD")
def decrypt_backup_cmd(archive: Path, output: Path, ask_password: bool) -> None:
    """Decrypt a backup archive into a plain ZIP (to inspect it or to move the data elsewhere)."""
    from .services import backup_crypto

    try:
        backup_crypto.decrypt_file(archive, output, _backup_password(ask_password))
    except backup_crypto.BackupCryptoError as e:
        raise click.ClickException(str(e)) from e
    click.echo(f"Decrypted {archive.name} -> {output} (contains resorixtrack.db, attachments/, manifest.json)")


@group.command("send-reminders")
def send_reminders_cmd() -> None:
    """Remind users who are still clocked in after `clock_reminder_hours`."""
    from .worker import send_clock_reminders

    click.echo(f"Sent {send_clock_reminders()} reminder(s).")


@group.command("worker")
@click.option("--interval", default=60, show_default=True, help="Seconds between job runs")
@click.option("--backup-hour", default=2, show_default=True, help="Local hour for the nightly backup")
def worker_cmd(interval: int, backup_hour: int) -> None:
    """Background jobs: clock-out reminders, nightly backup, cleanup."""
    from .worker import run_forever

    run_forever(current_app._get_current_object(), interval=interval, backup_hour=backup_hour)


def register_cli(app: Flask) -> None:
    app.cli.add_command(group)

