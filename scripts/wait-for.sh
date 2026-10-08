#!/usr/bin/env bash
# wait-for.sh — block until a TCP host:port accepts connections, or time out.
#
# Usage: wait-for.sh HOST:PORT [-t SECONDS] [-- COMMAND ARGS...]
#   -t SECONDS   timeout in seconds (default: 60)
#   -- COMMAND   optional command to exec once the port is reachable
#
# No external dependencies beyond bash's /dev/tcp (works in the debian/alpine bash images used
# elsewhere in this repo). Used by scripts/smoke-test.sh and scripts/validate-configs.sh, and
# safe to `docker cp` into a container or run on the host.
set -euo pipefail

usage() {
  echo "usage: $0 HOST:PORT [-t SECONDS] [-- COMMAND ARGS...]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
hostport="$1"; shift
host="${hostport%%:*}"
port="${hostport##*:}"
[[ -n "$host" && -n "$port" && "$port" =~ ^[0-9]+$ ]] || usage

timeout_secs=60
while [[ $# -gt 0 ]]; do
  case "$1" in
    -t)
      timeout_secs="${2:?missing value for -t}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      ;;
  esac
done

deadline=$((SECONDS + timeout_secs))
echo "wait-for: waiting for ${host}:${port} (timeout ${timeout_secs}s)..."
until (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; do
  if [[ $SECONDS -ge $deadline ]]; then
    echo "wait-for: timed out waiting for ${host}:${port}" >&2
    exit 1
  fi
  sleep 1
done
exec 3>&- 2>/dev/null || true
echo "wait-for: ${host}:${port} is up."

if [[ $# -gt 0 ]]; then
  exec "$@"
fi
