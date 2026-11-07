#!/bin/sh
# web: apply migrations, then serve. worker: background jobs (opening the database applies pending migrations
# under a SQLite lock, so both may start together). Anything else runs as a command, e.g. `rt create-admin`.
set -eu
case "${1:-web}" in
  web)
    node /app/dist/node/cli.mjs migrate
    exec node /app/server.mjs
    ;;
  worker)
    exec node /app/dist/node/worker.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
