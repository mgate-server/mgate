#!/bin/bash
# entrypoint.sh — load the base nftables ruleset (idempotent: delete-then-reload the table so a
# container restart never duplicates rules/sets), then exec mgate-agent (or whatever CMD/args
# were given, e.g. for interactive debugging).
set -euo pipefail

log() { echo "[firewall-entrypoint] $*"; }

log "loading base ruleset from /etc/mgate/nftables.conf"
nft delete table inet mgate_filter 2>/dev/null || true
nft -f /etc/mgate/nftables.conf
log "table inet mgate_filter loaded; set mgate_ban ready"

exec "$@"
