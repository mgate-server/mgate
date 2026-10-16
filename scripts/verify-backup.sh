#!/usr/bin/env bash
# scripts/verify-backup.sh — verifies restic backup repository and checks database archive validity.
# Runs via Docker Compose (using backup service profile) or natively if restic is available.
#
# Usage:
#   ./scripts/verify-backup.sh [SNAPSHOT_ID]   (default SNAPSHOT_ID: latest)
set -uo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

SNAPSHOT="${1:-latest}"

COMPOSE="${COMPOSE:-docker compose -f docker-compose.yml}"

echo "[verify-backup] running backup verification (snapshot=${SNAPSHOT})..."
${COMPOSE} --profile backup run --rm backup /usr/local/bin/verify-backup.sh "${SNAPSHOT}"
exit $?
