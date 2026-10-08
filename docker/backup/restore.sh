#!/bin/bash
# restore.sh — interactive restore of a restic snapshot: pg_restore into POSTGRES_DB (DESTRUCTIVE:
# drops and recreates the target database) and restores /var/vmail + /certs in place.
#
# Runs in the compose `restore` service (`make restore [SNAPSHOT=<id>]`), which mounts vmail and
# certs read-write and grants DAC_OVERRIDE/CHOWN/FOWNER so files get back their original owners
# (vmail 5000:5000, mgate 10001:10001), modes and timestamps. The scheduled `backup` service mounts
# them read-only and cannot restore.
#
# Mail and certificates are restored straight onto their volumes (no full staging copy, so a
# restore needs no free space beyond the restored data itself). Files present in the snapshot are
# overwritten with the snapshot version; files created after the snapshot (newer mail) are kept.
#
# Usage: restore.sh [SNAPSHOT_ID]   (default SNAPSHOT_ID: latest)
# Env:   MGATE_RESTORE_YES=1        skip the interactive confirmation (for scripted DR drills —
#                                   use with extreme care, never in a habitual/cron context)
set -uo pipefail

: "${POSTGRES_DB:?POSTGRES_DB required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD required}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
SNAPSHOT="${1:-latest}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export RESTIC_REPOSITORY RESTIC_PASSWORD

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR: $*" >&2; exit 1; }

log "target snapshot: ${SNAPSHOT}"
if ! restic snapshots --host mgate >/dev/null 2>&1; then
  die "restic repository not reachable/initialized at ${RESTIC_REPOSITORY}"
fi

echo
echo "!!!  DESTRUCTIVE OPERATION  !!!"
echo "This will:"
echo "  1. DROP AND RECREATE the database '${POSTGRES_DB}' on ${PGHOST}:${PGPORT}"
echo "  2. Overwrite /var/vmail and /certs with the contents of snapshot '${SNAPSHOT}'"
echo "Stop api, webmail, worker, postfix and dovecot first (docker compose stop ...)."
echo

if [[ "${MGATE_RESTORE_YES:-0}" != "1" ]]; then
  read -r -p "Type the database name (${POSTGRES_DB}) to confirm, anything else aborts: " confirm
  if [[ "$confirm" != "$POSTGRES_DB" ]]; then
    echo "Aborted (confirmation did not match)." >&2
    exit 1
  fi
else
  log "MGATE_RESTORE_YES=1 set — skipping interactive confirmation"
fi

workdir="$(mktemp -d /var/lib/mgate-backup/restore.XXXXXX)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

# --- 1. database dump (only the dump is staged; current backups keep it at
#        /var/lib/mgate-backup/pgdump/<db>.dump, older ones under /var/lib/mgate-backup/run.*/) ---
log "restic restore ${SNAPSHOT} (database dump) -> ${workdir}"
restic restore "$SNAPSHOT" --host mgate --target "$workdir" --include /var/lib/mgate-backup \
  || die "restic restore of the database dump failed"

dump_file="$(find "$workdir" -type f -name "${POSTGRES_DB}.dump" -print -quit)"
[[ -n "$dump_file" ]] || die "no ${POSTGRES_DB}.dump found in snapshot ${SNAPSHOT}"

log "recreating database '${POSTGRES_DB}'"
# WITH (FORCE) terminates remaining sessions atomically with the drop (PostgreSQL 13+), so a
# client reconnecting between a separate pg_terminate_backend() and the DROP cannot block it.
psql -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\" WITH (FORCE)" \
  -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\"" \
  || die "could not recreate database ${POSTGRES_DB}"

# The read-only mail role (docker/postgres/initdb) had CONNECT on the old database; database-level
# grants are not part of a single-database dump, so re-grant it (table/view grants are restored
# by pg_restore itself).
mail_user="${POSTGRES_MAIL_USER:-}"
if [[ -n "$mail_user" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -qtA \
    -v db="$POSTGRES_DB" -v role="$mail_user" <<'SQL' || log "warn: could not re-grant CONNECT to the mail role"
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'role')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SQL
fi

log "pg_restore ${dump_file#"$workdir"} -> ${POSTGRES_DB}"
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --role="$POSTGRES_USER" --exit-on-error "$dump_file" \
  || die "pg_restore failed — the database is incomplete; fix the cause and run the restore again"
rm -f -- "$dump_file" # free the space before the (possibly large) mail restore

# --- 2. mail store and certificates, restored in place ----------------------------------------
targets=()
[[ -d /var/vmail ]] && targets+=(--include /var/vmail)
[[ -d /certs ]] && targets+=(--include /certs)
if [[ ${#targets[@]} -gt 0 ]]; then
  log "restic restore ${SNAPSHOT} (${targets[*]}) -> /"
  restic restore "$SNAPSHOT" --host mgate --target / "${targets[@]}" \
    || die "restic restore of /var/vmail and /certs failed (mounts not writable, or see output above)"
fi

log "restore completed. Next: 'make migrate' (or 'docker compose up -d', which runs migrate first)"
log "to bring the schema up to the current image version, then start the stopped services."
