# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
"""Schema migrations: one linear chain, no drift from the models, safe upgrades with data."""

from __future__ import annotations

import sqlite3

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from flask_migrate import upgrade

from resorixtrack import create_app
from resorixtrack.extensions import db


@pytest.fixture
def bare_app(tmp_path):
    """App with an EMPTY database (no create_all) - like a fresh production install."""
    app = create_app("testing", overrides={"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'm.db'}",
                                           "DATA_DIR": tmp_path})
    with app.app_context():
        yield app
        db.session.remove()
        db.engine.dispose()


def _script(app) -> ScriptDirectory:
    return ScriptDirectory.from_config(app.extensions["migrate"].migrate.get_config())


def test_single_linear_head(bare_app):
    script = _script(bare_app)
    assert len(script.get_heads()) == 1, "migrations must form a single linear chain"
    for rev in script.walk_revisions():
        assert not rev.is_merge_point or rev.is_merge_point is False


def test_upgrade_from_empty_matches_models(bare_app):
    upgrade()
    with db.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": False}), db.metadata)
    assert diff == [], f"models and migrations differ - run `make migration`: {diff}"


def test_upgrade_from_every_revision_keeps_data(tmp_path):
    """Skipping versions: start at each historical revision, add data, upgrade to head."""
    probe = create_app("testing", overrides={"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'p.db'}",
                                             "DATA_DIR": tmp_path})
    with probe.app_context():
        revisions = [r.revision for r in reversed(list(_script(probe).walk_revisions()))]
        head = _script(probe).get_current_head()
    for rev in revisions:
        path = tmp_path / f"from-{rev}.db"
        app = create_app("testing", overrides={"SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}", "DATA_DIR": tmp_path})
        with app.app_context():
            upgrade(revision=rev)
            con = sqlite3.connect(path)
            con.execute("INSERT INTO users (email, name, role, timezone, locale, vacation_days_per_year, is_active, "
                        "notify_email_on_correction, created_at) VALUES ('keep@x.ch', 'Keep', 'admin', "
                        "'Europe/Zurich', 'en', 25, 1, 1, '2026-01-01 00:00:00')")
            con.commit()
            con.close()
            upgrade()
            with db.engine.connect() as conn:
                assert MigrationContext.configure(conn).get_current_revision() == head
                assert conn.exec_driver_sql("SELECT name FROM users WHERE email='keep@x.ch'").scalar() == "Keep"
            db.engine.dispose()


def test_migrate_check_on_empty_db(bare_app):
    assert bare_app.test_cli_runner().invoke(args=["resorixtrack", "migrate", "--check"]).exit_code == 1


def test_migrate_command_backs_up_before_upgrading(bare_app, tmp_path):
    # existing data in a database that is not yet migrated
    con = sqlite3.connect(tmp_path / "m.db")
    con.execute("CREATE TABLE legacy_data (id INTEGER PRIMARY KEY, v TEXT)")
    con.execute("INSERT INTO legacy_data (v) VALUES ('precious')")
    con.commit()
    con.close()
    runner = bare_app.test_cli_runner()
    result = runner.invoke(args=["resorixtrack", "migrate"])
    assert result.exit_code == 0, result.output
    assert "Pre-migration backup" in result.output
    backups = list((tmp_path / "backups").glob("resorixtrack-*-premigrate.zip.enc"))
    assert len(backups) == 1
    assert runner.invoke(args=["resorixtrack", "migrate", "--check"]).exit_code == 0
    again = runner.invoke(args=["resorixtrack", "migrate"])
    assert again.exit_code == 0 and "up to date" in again.output
    assert len(list((tmp_path / "backups").glob("*.zip.enc"))) == 1  # no backup when nothing is pending


def test_migrate_refuses_newer_database(bare_app, tmp_path):
    runner = bare_app.test_cli_runner()
    assert runner.invoke(args=["resorixtrack", "migrate"]).exit_code == 0
    con = sqlite3.connect(tmp_path / "m.db")
    con.execute("UPDATE alembic_version SET version_num='9999_from_the_future'")
    con.commit()
    con.close()
    result = runner.invoke(args=["resorixtrack", "migrate"])
    assert result.exit_code != 0
    assert "does not know" in result.output


def test_cli_create_admin_and_presets(bare_app):
    runner = bare_app.test_cli_runner()
    assert runner.invoke(args=["resorixtrack", "migrate", "--no-backup"]).exit_code == 0
    r = runner.invoke(args=["resorixtrack", "create-admin", "--email", "boss@example.nomail", "--name", "Boss",
                            "--password", "A-strong-admin-pass-1"])
    assert r.exit_code == 0, r.output
    r = runner.invoke(args=["resorixtrack", "install-holidays"])
    assert "36 holidays" in r.output
    r = runner.invoke(args=["resorixtrack", "create-admin", "--email", "x@example.nomail", "--name", "X", "--password", "short"])
    assert r.exit_code != 0
