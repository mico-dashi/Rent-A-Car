#!/usr/bin/env bash
# Downloads PostgREST and Supabase Auth (GoTrue) Linux x64 binaries into ./.bin
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .bin
PGRST=v12.2.3
AUTH=v2.177.0
[ -x .bin/postgrest ] || { curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${PGRST}/postgrest-${PGRST}-linux-static-x64.tar.xz" | tar xJ -C .bin; }
[ -x .bin/auth ] || { curl -fsSL "https://github.com/supabase/auth/releases/download/${AUTH}/auth-${AUTH}-x86.tar.gz" | tar xz -C .bin; }
echo "binaries ready in $(pwd)/.bin"
