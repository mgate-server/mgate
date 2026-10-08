#!/usr/bin/env bash
# Runs once, on first initialization of an empty PostgreSQL data directory, via the official
# postgres image's /docker-entrypoint-initdb.d mechanism (executed as POSTGRES_USER against
# POSTGRES_DB, see https://hub.docker.com/_/postgres "Initialization scripts").
#
# Creates the read-only role Postfix/Dovecot use for their SQL lookups:
# LOGIN only, CONNECT on the database, no other privileges. View-level SELECT grants are applied
# by the backend migrations (run by the `migrate` service; guarded by a DO block, so it is safe to apply the
# migrations before or after this script has run).
#
# Idempotent: safe to re-run manually (e.g. against an already-initialized cluster) because it
# checks pg_roles before creating and uses ALTER ROLE to converge the password otherwise. Note
# that the postgres image itself only executes *this script* on a first, empty-volume init.

set -euo pipefail

MAIL_USER="${POSTGRES_MAIL_USER:-mgate_mail}"
MAIL_PASSWORD="${POSTGRES_MAIL_PASSWORD:-}"

if [[ -z "${MAIL_PASSWORD}" ]]; then
    echo "postgres/initdb/10-create-mail-role.sh: POSTGRES_MAIL_PASSWORD is not set;" \
         "refusing to create role '${MAIL_USER}' without a password." >&2
    exit 1
fi

# Defense in depth: MAIL_USER ends up interpolated into SQL via format(%I, ...) below, which is
# safe against injection regardless, but a strict charset check catches config typos early.
if [[ ! "${MAIL_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "postgres/initdb/10-create-mail-role.sh: POSTGRES_MAIL_USER='${MAIL_USER}' is not a" \
         "valid unquoted PostgreSQL identifier." >&2
    exit 1
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
    DO \$do\$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MAIL_USER}') THEN
            EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${MAIL_USER}', '${MAIL_PASSWORD}');
        ELSE
            EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${MAIL_USER}', '${MAIL_PASSWORD}');
        END IF;
    END;
    \$do\$;

    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${MAIL_USER}";
EOSQL

echo "postgres/initdb/10-create-mail-role.sh: role '${MAIL_USER}' ready (LOGIN, CONNECT on ${POSTGRES_DB})."
