#!/bin/bash
# backup.sh — pg_dump (custom format) + restic snapshot of the dump, /var/vmail (ro) and /certs;
# applies the BACKUP_KEEP_* retention policy; reports the outcome to the internal API.
#
# Run standalone (`make backup`, or via `docker compose run --rm backup /usr/local/bin/backup.sh`)
# or on the cron schedule (entrypoint.sh -> supercronic). Idempotent restic repo init.
#
# The dump is always written to the same path, ${DUMP_DIR}/${POSTGRES_DB}.dump
# (/var/lib/mgate-backup/pgdump/mgate.dump by default), so every snapshot carries it at a
# predictable location (docs/BACKUP.md, restore.sh). A lock file keeps two runs inside one
# container (cron + a manual `docker compose exec backup backup.sh`) from sharing it.
set -uo pipefail

: "${POSTGRES_DB:?POSTGRES_DB required}"
: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD required}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-6}"
INTERNAL_API="${MGATE_INTERNAL_API:-http://api:8081}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export RESTIC_REPOSITORY RESTIC_PASSWORD

state_dir=/var/lib/mgate-backup
DUMP_DIR="${state_dir}/pgdump"
dump_file="${DUMP_DIR}/${POSTGRES_DB}.dump"
started_at="$(date -u +%FT%TZ)"
status="ok"
error_detail=""

exec 9>"${state_dir}/.backup.lock"
if ! flock -n 9; then
  echo "[backup] ERROR: another backup.sh run holds ${state_dir}/.backup.lock — skipping" >&2
  exit 1
fi

cleanup() {
  rm -rf "$DUMP_DIR"
}
trap cleanup EXIT
rm -rf "$DUMP_DIR"
mkdir -m 0700 "$DUMP_DIR"

log() { echo "[backup] $*"; }

report() {
  local finished_at size_bytes
  finished_at="$(date -u +%FT%TZ)"
  size_bytes="$(du -sb "$dump_file" 2>/dev/null | cut -f1 || echo 0)"
  # TODO(S2): confirm the exact /internal/v1/backup/report request/response schema against the
  # backend API; this is a best-effort POST and never fails the backup itself.
  if [[ -n "${MGATE_INTERNAL_TOKEN:-}" ]]; then
    if curl -fsS -m 10 -X POST "${INTERNAL_API}/internal/v1/backup/report" \
      -H "Authorization: Bearer ${MGATE_INTERNAL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"${status}\",\"started_at\":\"${started_at}\",\"finished_at\":\"${finished_at}\",\"size_bytes\":${size_bytes},\"error\":\"${error_detail}\"}" \
      >/dev/null 2>&1; then
      log "reported status=${status} to ${INTERNAL_API}/internal/v1/backup/report"
    else
      log "warn: could not reach ${INTERNAL_API}/internal/v1/backup/report (non-fatal, api may not be running yet)"
    fi
  else
    log "warn: MGATE_INTERNAL_TOKEN not set — skipping backup report"
  fi
}

fail() {
  status="failed"
  error_detail="$1"
  log "ERROR: $1"
  report
  exit 1
}

log "starting backup (db=${POSTGRES_DB}@${PGHOST}:${PGPORT}, repo=${RESTIC_REPOSITORY})"

# --- restic repo: init once, idempotently ----------------------------------------------------
if ! restic snapshots >/dev/null 2>&1; then
  log "restic repository not initialized yet, running 'restic init'"
  restic init || fail "restic init failed"
fi

# --- pg_dump (custom format: supports selective pg_restore, compressed) ----------------------
log "pg_dump -> ${dump_file}"
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -Fc -f "$dump_file" "$POSTGRES_DB" \
  || fail "pg_dump failed"

# --- restic backup: the dump + mail storage (ro) + certificates (ro) -------------------------
backup_paths=("$dump_file")
[[ -d /var/vmail ]] && backup_paths+=(/var/vmail)
[[ -d /certs ]] && backup_paths+=(/certs)

log "restic backup: ${backup_paths[*]}"
restic backup --host mgate --tag mgate-backup "${backup_paths[@]}" || fail "restic backup failed"

# DKIM/ARC keys: PostgreSQL is the source of truth (domain_dkim_keys.private_key_enc, encrypted
# with MGATE_SECRET_KEY), so they are already inside the pg_dump above. The Valkey db 1 hashes
# DKIM_KEYS/DKIM_SELECTORS that Rspamd reads are only a cache that mgate republishes from the DB
# (TODO(S1): republish on startup/restore in the backend). Valkey itself is not backed up.
# A restore therefore needs the same MGATE_SECRET_KEY to decrypt the keys (keep .env safe).
log "DKIM keys are included via the database dump (Valkey copy is a cache republished by mgate)"

# --- retention -------------------------------------------------------------------------------
log "applying retention: keep-daily=${BACKUP_KEEP_DAILY} keep-weekly=${BACKUP_KEEP_WEEKLY} keep-monthly=${BACKUP_KEEP_MONTHLY}"
restic forget \
  --host mgate \
  --keep-daily "$BACKUP_KEEP_DAILY" \
  --keep-weekly "$BACKUP_KEEP_WEEKLY" \
  --keep-monthly "$BACKUP_KEEP_MONTHLY" \
  --prune \
  || fail "restic forget/prune failed"

log "backup completed successfully"
report
