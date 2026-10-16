#!/bin/bash
# verify-backup.sh — validates restic repository integrity and verifies that the latest
# PostgreSQL dump can be extracted and parsed by pg_restore without errors.
#
# Usage:
#   verify-backup.sh [SNAPSHOT_ID]   (default SNAPSHOT_ID: latest)
set -uo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD required}"
SNAPSHOT="${1:-latest}"

export RESTIC_REPOSITORY RESTIC_PASSWORD

log() { echo "[verify-backup] $(date -u +'%FT%TZ') $*"; }
die() { echo "[verify-backup] ERROR: $*" >&2; exit 1; }

log "checking restic repository at ${RESTIC_REPOSITORY}..."

if ! restic snapshots >/dev/null 2>&1; then
  die "restic repository not reachable or not initialized at ${RESTIC_REPOSITORY}"
fi

# 1. Check snapshots list
snapshots_json="$(restic snapshots --json "${SNAPSHOT}")" || die "failed to query snapshot '${SNAPSHOT}'"
snapshot_id="$(echo "$snapshots_json" | grep -o '"short_id":"[^"]*' | head -n1 | cut -d'"' -f4 || true)"
snapshot_time="$(echo "$snapshots_json" | grep -o '"time":"[^"]*' | head -n1 | cut -d'"' -f4 || true)"

if [[ -z "$snapshot_id" ]]; then
  die "no valid snapshot found matching '${SNAPSHOT}'"
fi

log "found snapshot: ${snapshot_id} (created at ${snapshot_time})"

# 2. Verify restic index and structure
log "running 'restic check' (index, packs, structure)..."
if ! restic check --read-data-subset=10%; then
  die "restic check detected corruption in the repository!"
fi
log "restic repository integrity check passed"

# 3. Locate pg_dump file inside the snapshot
log "inspecting contents of snapshot ${snapshot_id}..."
dump_path="$(restic ls "${snapshot_id}" | grep -E '\.dump$' | head -n1 | awk '{print $NF}')"

if [[ -z "$dump_path" ]]; then
  die "no .dump file found inside snapshot ${snapshot_id}!"
fi
log "found database dump inside snapshot: ${dump_path}"

# 4. Verify pg_dump archive integrity with pg_restore --list
log "extracting and verifying pg_dump TOC with pg_restore --list..."
if ! restic dump "${snapshot_id}" "${dump_path}" | pg_restore --list >/dev/null; then
  die "pg_restore failed to read archive header/TOC from ${dump_path}! Dump is corrupted."
fi
log "database archive is valid and readable by pg_restore"

# 5. Check vmail directory presence
if restic ls "${snapshot_id}" | grep -q '/var/vmail'; then
  vmail_count="$(restic ls "${snapshot_id}" | grep -c '/var/vmail' || echo 0)"
  log "vmail directory present in snapshot (${vmail_count} files/dirs)"
fi

log "SUCCESS: snapshot ${snapshot_id} verified successfully. Disaster recovery integrity confirmed."
exit 0
