#!/usr/bin/env bash
# Provision a disposable database (shim + migrations + seed) and run the
# database integration suite against it.
# Requires DATABASE_URL pointing at a PostgreSQL 15+ server where we may create databases.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DATABASE_URL:=postgres://postgres@127.0.0.1:5432/postgres}"
DB="rental_it_$$"
"$ROOT/scripts/db-reset-local.sh" "$DB" --seed
export TEST_DATABASE_URL="${DATABASE_URL%/*}/$DB"
cleanup() { psql "$DATABASE_URL" -qc "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
pnpm --filter @rental/database run test:integration
