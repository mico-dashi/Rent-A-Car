#!/usr/bin/env bash
# Flags destructive statements that run when a migration is applied
# (DROP TABLE/COLUMN/SCHEMA/TYPE, TRUNCATE, ALTER TABLE … DROP, DELETE FROM).
# Function bodies ($$…$$ / $tag$…$tag$) and comments are ignored: a DELETE
# inside a function only runs when that function is called, not on migrate.
# Usage: scripts/check-destructive-migrations.sh <file.sql>...   (exit 1 on findings)
set -euo pipefail
status=0
for f in "$@"; do
  hits=$(perl -0777 -ne '
    s/\$([A-Za-z_]*)\$.*?\$\1\$/ /gs;   # dollar-quoted bodies
    s{/\*.*?\*/}{ }gs;                  # block comments
    s/--[^\n]*//g;                      # line comments
    for my $stmt (split /;/) {
      (my $one = $stmt) =~ s/\s+/ /g;
      print "$one\n" if $one =~ /\b(drop\s+(table|column|schema|type)|truncate|alter\s+table\s+\S+\s+drop|delete\s+from)\b/i;
    }' "$f")
  if [ -n "$hits" ]; then
    status=1
    while IFS= read -r line; do echo "$f: ${line:0:200}"; done <<< "$hits"
  fi
done
exit $status
