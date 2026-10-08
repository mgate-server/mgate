#!/usr/bin/env bash
# gen-secrets.sh — generate a working .env from .env.example.
#
# Idempotent: if .env already exists, every variable that already has a non-empty value in it
# is left untouched; only variables that are missing or empty get a freshly generated value.
# Variables present in .env but absent from .env.example (operator additions such as
# HTTPS_PROXY or MGATE_DEV_API_PORT, or variables an older .env.example still had) are never
# dropped: they are carried over verbatim into a clearly marked block at the end of the new .env.
# Safe to re-run at any time (e.g. after .env.example gained a new variable upstream).
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Default to the repo's own .env.example/.env; pass explicit arguments to operate on any other
# directory (used by CI/tests to exercise this script against a throwaway temp dir without
# touching the real .env). Deliberately does NOT `cd` into repo_root, so relative arguments
# resolve against the caller's current directory, not this script's location.
ENV_EXAMPLE="${1:-$repo_root/.env.example}"
ENV_FILE="${2:-$repo_root/.env}"

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo "error: $ENV_EXAMPLE not found" >&2
  exit 1
fi

# Variables that get a freshly generated secret when empty/missing. Keys not listed here are
# copied from .env.example verbatim (or left as-is if already present in .env).
GENERATED_VARS=(
  POSTGRES_PASSWORD
  POSTGRES_MAIL_PASSWORD
  VALKEY_PASSWORD
  MGATE_SECRET_KEY
  MGATE_INTERNAL_TOKEN
  DOVEADM_API_KEY
  RSPAMD_CONTROLLER_PASSWORD
  RESTIC_PASSWORD
)

gen_token() {
  # 32 random bytes, base64url (no padding) — safe to embed unquoted in .env / shell exports
  # and in connection URLs (no '/', '+', '=' that would need escaping).
  openssl rand -base64 33 2>/dev/null | tr '+/' '-_' | tr -d '=\n' \
    || head -c 33 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'
}

gen_secret_key() {
  # MGATE_SECRET_KEY must decode to exactly 32 bytes (XChaCha20-Poly1305 key) — plain base64,
  # not base64url (see docs/CONFIGURATION.md).
  openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
}

declare -A existing=()
# Keys of the existing .env in file order (associative arrays are unordered), so variables that
# .env.example does not know about can be re-emitted in the order the operator wrote them.
existing_order=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    # Plain prefix-stripping (not `read -d=`/`IFS='='`): several generated secrets are base64
    # and may end in a literal '=' padding character, which `read` with IFS='=' would eat.
    [[ -v existing["${BASH_REMATCH[1]}"] ]] || existing_order+=("${BASH_REMATCH[1]}")
    existing["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
  done <"$ENV_FILE"
fi

# Keys already written to the new file (from .env.example).
declare -A emitted=()

tmp_out="$(mktemp)"
trap 'rm -f "$tmp_out"' EXIT

changed=0
added=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    default_value="${BASH_REMATCH[2]}"
    emitted["$key"]=1
    if [[ -v existing["$key"] && -n "${existing[$key]}" ]]; then
      # Keep the value already present in .env untouched.
      printf '%s=%s\n' "$key" "${existing[$key]}" >>"$tmp_out"
      continue
    fi
    is_generated=0
    for gv in "${GENERATED_VARS[@]}"; do
      [[ "$gv" == "$key" ]] && is_generated=1 && break
    done
    if [[ $is_generated -eq 1 ]]; then
      if [[ "$key" == "MGATE_SECRET_KEY" ]]; then
        value="$(gen_secret_key)"
      else
        value="$(gen_token)"
      fi
      printf '%s=%s\n' "$key" "$value" >>"$tmp_out"
      changed=$((changed + 1))
    else
      printf '%s=%s\n' "$key" "$default_value" >>"$tmp_out"
    fi
    if [[ ! -v existing["$key"] ]]; then
      added=$((added + 1))
    fi
  else
    # Comment / blank line: preserve as-is (documentation).
    printf '%s\n' "$line" >>"$tmp_out"
  fi
done <"$ENV_EXAMPLE"

# Carry over every variable of the existing .env that .env.example does not define, verbatim
# (value untouched, even when empty), instead of silently dropping it.
preserved=0
for key in "${existing_order[@]}"; do
  [[ -v emitted["$key"] ]] && continue
  if [[ $preserved -eq 0 ]]; then
    {
      printf '\n'
      printf '# =============================================================================\n'
      printf '# Переменные, которых нет в .env.example: перенесены из прежнего .env\n'
      printf '# скриптом scripts/gen-secrets.sh (make init) без изменений. Блок\n'
      printf '# пересобирается при каждом запуске — правьте значения здесь, как обычно.\n'
      printf '# =============================================================================\n'
    } >>"$tmp_out"
  fi
  printf '%s=%s\n' "$key" "${existing[$key]}" >>"$tmp_out"
  emitted["$key"]=1
  preserved=$((preserved + 1))
done

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak"
  echo "note: previous $ENV_FILE saved as ${ENV_FILE}.bak"
fi
mv "$tmp_out" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Wrote $ENV_FILE ($changed secret(s) generated, $added new variable(s) added, $preserved variable(s) not in $(basename -- "$ENV_EXAMPLE") preserved)."
echo "Review MGATE_HOSTNAME / MGATE_ADMIN_EMAIL before deploying: $ENV_FILE"
