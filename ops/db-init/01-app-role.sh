#!/bin/bash
# Create the non-owner role the API connects as, so row-level security actually applies.
#
# This is an init script rather than a migration for two reasons. A migration should not need
# CREATEROLE, and 20260718140000_row_level_security says so explicitly — it skips its GRANTs when
# the role is absent so the chain still runs clean on a fresh CI database. But that means the
# grants only land if the role exists BEFORE `prisma migrate deploy` runs.
#
# Postgres runs everything in /docker-entrypoint-initdb.d once, at first boot, before anything
# else can connect. That ordering is the whole point of this file: role first, then migrate, then
# the grants inside the migration find something to grant to.
#
# A shell script rather than plain .sql because the entrypoint runs .sql files with no way to
# pass a variable, and the password must come from the environment rather than version control.
set -euo pipefail

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "[db-init] APP_DB_PASSWORD is not set — refusing to create eyo_app with an empty password." >&2
  echo "[db-init] Set it in .env. Without this role the API connects as the owner and RLS is OFF." >&2
  exit 1
fi

psql_do() {
  psql -v ON_ERROR_STOP=1 --no-password \
       --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

# The existence check lives in shell rather than a DO block on purpose: psql does not substitute
# :'variables' inside dollar-quoted strings, so a DO block would try to set the password to the
# literal text ":'app_password'". Outside one, substitution works and quotes correctly.
if [ -z "$(psql_do -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app'")" ]; then
  psql_do -v app_password="$APP_DB_PASSWORD" \
          -c "CREATE ROLE eyo_app LOGIN PASSWORD :'app_password'"
fi

# No BYPASSRLS, no SUPERUSER, not the table owner. Any one of those would silently switch every
# policy off, which is the exact failure this role exists to prevent.
psql_do -c "ALTER ROLE eyo_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE"
psql_do -v db="$POSTGRES_DB" -c 'GRANT CONNECT ON DATABASE :"db" TO eyo_app'
psql_do -c "GRANT USAGE ON SCHEMA public TO eyo_app"

echo "[db-init] eyo_app created. The API must connect as this role, not as $POSTGRES_USER."
