#!/usr/bin/env bash
# Restore check of an (unsealed, temporary) backup folder inside WSL, where the
# PostgreSQL + pgvector binaries come from the official Ubuntu packages and are
# not subject to Windows Smart App Control. Called by protect.ps1:
#
#   wsl.exe -d Ubuntu -e bash <repo>/scripts/backup/wsl-restore-check.sh <windows backup dir> <windows repo dir> [<windows migration dir> ...]
#
# Migration dirs, if given, are rehearsed on the restored copy (verify-restore.mjs --migrations).
#
# PostgreSQL lives unpacked (no root, no service) under $MJUFIND_PG_ROOT
# (default ~/mjufind-pg/root, made with `apt-get download postgresql-18
# postgresql-client-18 libpq5 postgresql-18-pgvector libnuma1 libicu78 liburing2`
# + `dpkg-deb -x`). A throwaway cluster is created under
# ~/.cache/mjufind-restore/run.XXXXXX, listens on 127.0.0.1 only, and is
# stopped and deleted on exit -- whatever the outcome.
set -euo pipefail

if [ "$#" -lt 2 ]; then echo "usage: wsl-restore-check.sh <windows backup dir> <windows repo dir> [<windows migration dir> ...]" >&2; exit 2; fi
PGROOT="${MJUFIND_PG_ROOT:-$HOME/mjufind-pg/root}"
BIN="$PGROOT/usr/lib/postgresql/18/bin"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu"
PORT="${MJUFIND_RESTORE_PORT:-55439}"
DIR="$(wslpath -a "$1")"
REPO="$(wslpath -a "$2")"
shift 2
MIGRATIONS=()
for m in "$@"; do MIGRATIONS+=("$(wslpath -a "$m")"); done
[ -x "$BIN/postgres" ] || { echo "PostgreSQL for WSL not found under $PGROOT" >&2; exit 3; }
[ -f "$DIR/SHA256SUMS" ] || { echo "not a backup folder: $DIR" >&2; exit 2; }

BASE="$HOME/.cache/mjufind-restore"
mkdir -p "$BASE"
WORK="$(mktemp -d "$BASE/run.XXXXXX")"
cleanup() {
  "$BIN/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null 2>&1 || true
  # Only ever this run's own scratch directory.
  case "$WORK" in
    "$BASE"/run.??????) rm -rf -- "$WORK" ;;
    *) echo "refusing to delete unexpected path: $WORK" >&2 ;;
  esac
}
trap cleanup EXIT

"$BIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --no-locale --no-sync >/dev/null
"$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/server.log" -w start >/dev/null
"$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres verify
echo "restore engine: $("$BIN/postgres" --version), pgvector $(ls "$PGROOT/usr/share/postgresql/18/extension/" | sed -n 's/^vector--\([0-9.]*\)\.sql$/\1/p' | sort -V | tail -1)"
cd "$REPO"
PG_BIN="$BIN" VERIFY_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/verify" node scripts/backup/verify-restore.mjs "$DIR" ${MIGRATIONS[@]+--migrations "${MIGRATIONS[@]}"}
