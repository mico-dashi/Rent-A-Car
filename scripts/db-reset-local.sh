#!/usr/bin/env bash
# Recreate a throwaway database on a plain PostgreSQL server, apply the
# Supabase shim, all migrations and (optionally) the seed.
# Usage: DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres scripts/db-reset-local.sh [dbname] [--seed]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
DB="${1:-rental_test}"
SEED="${2:-}"
TARGET_URL="${ADMIN_URL%/*}/$DB"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "alter database $DB set search_path = public, extensions" >/dev/null
run() { psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -q -o /dev/null -f "$1" 2> >(grep -v NOTICE >&2); }
run "$ROOT/supabase/tests/shim/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "apply $(basename "$f")"
  run "$f"
done
if [ "$SEED" = "--seed" ]; then
  echo "seed"
  run "$ROOT/supabase/seed.sql"
fi
echo "ok: $TARGET_URL"
