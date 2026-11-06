#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
# RESORIXtrack container entrypoint.
#   web     - apply pending migrations (with automatic pre-migration backup), then start gunicorn
#   worker  - wait until the schema is current, then run background jobs (reminders, nightly backup)
#   other   - run as command, e.g. `flask resorixtrack create-admin ...`
set -eu

case "${1:-web}" in
  web)
    flask resorixtrack migrate
    exec gunicorn --config /app/gunicorn.conf.py "resorixtrack:create_app()"
    ;;
  worker)
    i=0
    until flask resorixtrack migrate --check >/dev/null 2>&1; do
      i=$((i + 1))
      if [ "$i" -gt 60 ]; then echo "database schema not ready after 120s" >&2; exit 1; fi
      sleep 2
    done
    exec flask resorixtrack worker
    ;;
  *)
    exec "$@"
    ;;
esac
