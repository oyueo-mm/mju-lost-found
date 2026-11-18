#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PGROOT="${MJUFIND_PG_ROOT:-$HOME/mjufind-pg/root}"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu"
PG="$PGROOT/usr/lib/postgresql/18/bin"
BASE="$HOME/.cache/mjufind-web-push-test"
mkdir -p "$BASE"
WORK="$(mktemp -d "$BASE/run.XXXXXX")"
PORT=55447
cleanup() {
  "$PG/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null 2>&1 || true
  case "$WORK" in "$BASE"/run.??????) rm -rf -- "$WORK";; *) exit 1;; esac
}
trap cleanup EXIT
"$PG/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --no-locale --no-sync >/dev/null
"$PG/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/server.log" -w start >/dev/null
"$PG/psql" -X -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -c 'CREATE EXTENSION vector' >/dev/null
cd "$REPO"
node.exe scripts/regression/web-push-device.mjs --isolated-local-postgres "$WORK/.s.PGSQL.$PORT"
