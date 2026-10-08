#!/bin/bash
# entrypoint.sh — render the crontab template with BACKUP_SCHEDULE, then either run supercronic
# (default: scheduled backups) or exec whatever command was given (`make backup` runs backup.sh
# in the `backup` service, `make restore` runs restore.sh in the `restore` service, both via
# `docker compose run`).
set -euo pipefail

: "${BACKUP_SCHEDULE:=0 3 * * *}"

# A local restic repository (RESTIC_REPOSITORY=/backups/...) lives on the MGATE_BACKUP_DIR bind
# mount. Docker creates a missing host directory root-owned, which is what this root process
# (without DAC_OVERRIDE in the `backup` service) can write to; a directory pre-created by another
# host user is not. Probe it once here so the failure is one clear line at start-up instead of a
# restic error at 03:00.
if [[ "${RESTIC_REPOSITORY:-}" == /* ]]; then
  repo_parent="$(dirname -- "$RESTIC_REPOSITORY")"
  probe="${repo_parent}/.mgate-write-test.$$"
  if ! { mkdir -p -- "$repo_parent" && : >"$probe" && rm -f -- "$probe"; } 2>/dev/null; then
    echo "entrypoint: ERROR: ${repo_parent} is not writable by uid $(id -u) inside the container." >&2
    echo "entrypoint: on the host, give MGATE_BACKUP_DIR (default ./backups) to root, e.g." >&2
    echo "entrypoint:   sudo chown -R 0:0 ./backups && sudo chmod 0700 ./backups" >&2
    echo "entrypoint: (rootless Docker: the directory must belong to the user running dockerd)." >&2
    exit 1
  fi
fi

rendered=/tmp/backup.crontab
sed "s|\${BACKUP_SCHEDULE}|${BACKUP_SCHEDULE}|" /etc/mgate/backup.crontab.tmpl >"$rendered"

if [[ $# -gt 0 ]]; then
  exec "$@"
fi
echo "entrypoint: scheduled backup.sh at '${BACKUP_SCHEDULE}' (${rendered})"
exec supercronic "$rendered"
