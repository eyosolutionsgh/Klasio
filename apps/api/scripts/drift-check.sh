#!/usr/bin/env bash
# Migration gate: the committed migration chain must exactly produce the schema.
# Creates a disposable shadow DB next to DATABASE_URL, then diffs migrations vs schema.
set -euo pipefail
SHADOW_DB="eyo_drift_shadow"
BASE_URL="${DATABASE_URL%/*}"
SHADOW_URL="${BASE_URL}/${SHADOW_DB}"
echo "DROP DATABASE IF EXISTS ${SHADOW_DB};" | npx prisma db execute --url "$DATABASE_URL" --stdin || true
echo "CREATE DATABASE ${SHADOW_DB};" | npx prisma db execute --url "$DATABASE_URL" --stdin
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_URL" \
  --exit-code
echo "No drift: migrations == schema."
