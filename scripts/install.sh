#!/usr/bin/env bash
# install.sh — one-shot onboarding for a fresh MGate host: sanity checks, secret generation,
# image pull and first `up`. Idempotent (safe to re-run); does not touch an existing .env.
#
# Usage: ./scripts/install.sh [--skip-port-check] [--skip-pull]
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

skip_port_check=0
skip_pull=0
for arg in "$@"; do
  case "$arg" in
    --skip-port-check) skip_port_check=1 ;;
    --skip-pull) skip_pull=1 ;;
    -h|--help)
      echo "usage: $0 [--skip-port-check] [--skip-pull]"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

ok()   { echo "  [OK]   $*"; }
warn() { echo "  [WARN] $*"; }
fail() { echo "  [FAIL] $*" >&2; }

echo "== MGate install: preflight checks =="

# --- docker & compose plugin -------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not installed or not on PATH — see https://docs.docker.com/engine/install/"
  exit 1
fi
ok "docker found: $(docker --version)"

if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose (v2 plugin) is not available — 'docker compose version' failed"
  exit 1
fi
ok "docker compose found: $(docker compose version --short 2>/dev/null || docker compose version)"

if ! docker info >/dev/null 2>&1; then
  fail "docker daemon not reachable (permission denied, or daemon not running)"
  exit 1
fi
ok "docker daemon reachable"

# --- required ports free -----------------------------------------------------
# 25/80/443 are the ports that MUST be free on a fresh host (Postfix SMTP, Traefik HTTP/HTTPS).
# 465/587/143/993/110/995/4190 are checked too but only warn, since some are less commonly
# already in use by another MTA/mail stack and a conflict there is still fixable post-install.
required_ports=(25 80 443)
soft_ports=(465 587 143 993 110 995 4190)

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Htln "sport = :$port" 2>/dev/null | grep -q . && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$" && return 0
  else
    # Fallback: try to bind via bash /dev/tcp is not possible for listen-check; assume free.
    return 1
  fi
  return 1
}

if [[ $skip_port_check -eq 0 ]]; then
  port_issue=0
  for p in "${required_ports[@]}"; do
    if port_in_use "$p"; then
      fail "port $p is already in use (required: SMTP/HTTP/HTTPS) — stop the conflicting service first"
      port_issue=1
    else
      ok "port $p is free"
    fi
  done
  for p in "${soft_ports[@]}"; do
    if port_in_use "$p"; then
      warn "port $p is already in use (mail submission/IMAP/POP3/Sieve) — MGate will fail to bind it"
    fi
  done
  if [[ $port_issue -eq 1 ]]; then
    fail "one or more required ports are busy; re-run with --skip-port-check to bypass this check"
    exit 1
  fi
else
  warn "port check skipped (--skip-port-check)"
fi

# --- hostname / PTR hints (informational only, never fatal) ------------------
if [[ -f .env ]]; then
  hostname_hint="$(grep -E '^MGATE_HOSTNAME=' .env | head -1 | cut -d= -f2-)"
elif [[ -f .env.example ]]; then
  hostname_hint="$(grep -E '^MGATE_HOSTNAME=' .env.example | head -1 | cut -d= -f2-)"
else
  hostname_hint=""
fi
if [[ -n "$hostname_hint" && "$hostname_hint" != "mail.example.com" ]]; then
  echo "== DNS hints for MGATE_HOSTNAME=$hostname_hint =="
  if command -v dig >/dev/null 2>&1; then
    a_record="$(dig +short A "$hostname_hint" | head -1 || true)"
    if [[ -n "$a_record" ]]; then
      ok "A record: $hostname_hint -> $a_record"
      ptr="$(dig +short -x "$a_record" | head -1 || true)"
      if [[ -n "$ptr" ]]; then
        ok "PTR record: $a_record -> $ptr"
      else
        warn "no PTR (rDNS) record for $a_record — most receiving MTAs require one for good deliverability"
      fi
    else
      warn "no A record found for $hostname_hint yet — point it at this host's public IP before going live"
    fi
  else
    warn "'dig' not found on host — skipping DNS/PTR hints (install dnsutils/bind-tools to enable)"
  fi
else
  warn "MGATE_HOSTNAME not customised yet — set it in .env before deploying to production"
fi

# --- generate secrets ---------------------------------------------------------
echo "== Generating .env (if needed) =="
./scripts/gen-secrets.sh

# --- pull + up ------------------------------------------------------------------
if [[ $skip_pull -eq 0 ]]; then
  echo "== Pulling images =="
  docker compose -f docker-compose.yml --env-file .env pull
else
  warn "image pull skipped (--skip-pull)"
fi

echo "== Starting MGate =="
docker compose -f docker-compose.yml --env-file .env up -d

cat <<'EOF'

MGate is starting. Useful next steps:
  make ps         # check container status
  make logs       # follow logs
  make smoke      # run the mail-delivery smoke test (see docs/TESTING.md)

First superadmin: login = MGATE_ADMIN_EMAIL from .env. If MGATE_ADMIN_PASSWORD was left empty,
the generated password is printed once by the migrate service:
  docker compose logs migrate | grep -A2 'initial superadmin'
Lost it? docker compose exec api mgate admin reset-password <MGATE_ADMIN_EMAIL>

The admin panel will be reachable at https://<MGATE_HOSTNAME> once ACME issues a certificate
(HTTP-01 requires port 80 reachable from the Internet at the hostname you configured).
EOF
