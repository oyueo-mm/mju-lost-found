#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PGROOT="${MJUFIND_PG_ROOT:-$HOME/mjufind-pg/root}"
export PG_BIN="$PGROOT/usr/lib/postgresql/18/bin"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu"
BASE="$HOME/.cache/mjufind-realtime-test"
mkdir -p "$BASE"
WORK="$(mktemp -d "$BASE/run.XXXXXX")"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null 2>&1 || true
  case "$WORK" in "$BASE"/run.??????) rm -rf -- "$WORK";; *) exit 1;; esac
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --no-locale --no-sync >/dev/null
export MJU_REALTIME_TEST_PORT=55443
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $MJU_REALTIME_TEST_PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/server.log" -w start >/dev/null
cd "$REPO"
node scripts/regression/realtime-local.mjs
