#!/bin/bash
# Ensure the crate application user and database exist.
# Postgres only runs init scripts on first volume init, so this script
# is mounted as an entrypoint hook to run on every container start.
# It is idempotent — safe to run repeatedly.

set -e

CRATE_USER="${CRATE_APP_USER:-crate}"
CRATE_PASS="${CRATE_APP_PASSWORD:-crate}"
CRATE_DB="${CRATE_APP_DB:-crate}"

# Wait for Postgres to be ready (entrypoint may call this before PG is up)
until pg_isready -U "$POSTGRES_USER" -q; do
  sleep 1
done

# Create app user if missing
psql -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${CRATE_USER}') THEN
      CREATE ROLE ${CRATE_USER} WITH LOGIN PASSWORD '${CRATE_PASS}';
    END IF;
  END
  \$\$;
SQL

# Create app database if missing
if ! psql -U "$POSTGRES_USER" -lqt | cut -d \| -f 1 | grep -qw "$CRATE_DB"; then
  createdb -U "$POSTGRES_USER" -O "$CRATE_USER" "$CRATE_DB"
fi

# Ensure ownership and permissions
psql -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" <<-SQL
  GRANT ALL PRIVILEGES ON DATABASE ${CRATE_DB} TO ${CRATE_USER};
  ALTER DATABASE ${CRATE_DB} OWNER TO ${CRATE_USER};
SQL
