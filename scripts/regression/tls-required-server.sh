#!/usr/bin/env bash
# Local stand-in for Supabase "Enforce SSL": a throwaway PostgreSQL that
# REJECTS every non-TLS connection (pg_hba: hostnossl ... reject) and accepts
# TLS ones with a self-signed certificate. Used to check which tools keep
# working once SSL is enforced (docs/operations/db-tls-2026-11-22.md).
# No Supabase project or real data is involved.
#
#   WSL:  PG_BIN=$HOME/mjufind-pg/root/usr/lib/postgresql/18/bin \
#         LD_LIBRARY_PATH=$HOME/mjufind-pg/root/usr/lib/x86_64-linux-gnu \
#         scripts/regression/tls-required-server.sh start [port]   # default 55441
#         scripts/regression/tls-required-server.sh stop
# Windows reaches it at 127.0.0.1:<port> (WSL2 localhost forwarding).
set -euo pipefail
PORT="${2:-55441}"
WORK="${TMPDIR:-/tmp}/mjufind-tls-required"
case "${1:-}" in
  start)
    rm -rf "$WORK"; mkdir -p "$WORK"
    "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
      -keyout "$WORK/data/server.key" -out "$WORK/data/server.crt" 2>/dev/null
    chmod 600 "$WORK/data/server.key"
    cat >"$WORK/data/pg_hba.conf" <<'EOF'
hostnossl all all 0.0.0.0/0 reject
hostnossl all all ::/0      reject
hostssl   all all 0.0.0.0/0 trust
hostssl   all all ::/0      trust
EOF
    "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" -w \
      -o "-p $PORT -k $WORK -c listen_addresses='*' -c ssl=on" start >/dev/null
    echo "tls-required PostgreSQL on port $PORT (non-TLS connections rejected)"
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null || true
    rm -rf "$WORK"
    echo stopped
    ;;
  *) echo "usage: $0 start [port] | stop" >&2; exit 2 ;;
esac
