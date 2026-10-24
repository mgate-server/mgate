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

# Detect free backend subnet if not set or if current subnet overlaps with existing networks
auto_subnet=""
auto_resolver_ip=""
auto_valkey_ip=""
auto_subnet_status="UNCHANGED"

if command -v python3 >/dev/null 2>&1; then
  subnet_raw="${existing[MGATE_BACKEND_SUBNET]:-}"
  subnet_out=$(python3 - "$subnet_raw" <<'PYCODE' 2>/dev/null || true
import ipaddress, itertools, json, shutil, subprocess, sys

raw_arg = sys.argv[1].strip() if len(sys.argv) > 1 else ''
req_subnet = raw_arg if raw_arg else '172.30.1.0/24'
project_name = 'mgate'

occupied = []
owned = set()

if shutil.which('docker'):
    try:
        net_ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True, stderr=subprocess.DEVNULL).split()
        if net_ids:
            nets = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *net_ids], text=True, stderr=subprocess.DEVNULL))
            for n in nets:
                is_own = n.get('Labels', {}).get('com.docker.compose.project') == project_name
                for cfg in n.get('IPAM', {}).get('Config') or []:
                    sub = cfg.get('Subnet')
                    if sub:
                        try:
                            net_obj = ipaddress.ip_network(sub, strict=False)
                            if is_own:
                                owned.add(net_obj)
                            else:
                                occupied.append(net_obj)
                        except Exception:
                            pass
    except Exception:
        pass

if shutil.which('ip'):
    try:
        routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show'], text=True, stderr=subprocess.DEVNULL))
        for r in routes:
            dst = r.get('dst', 'default')
            if dst != 'default':
                try:
                    net_obj = ipaddress.ip_network(dst, strict=False)
                    if net_obj.prefixlen > 1 and net_obj not in owned:
                        occupied.append(net_obj)
                except Exception:
                    pass
    except Exception:
        pass

    try:
        addrs = json.loads(subprocess.check_output(['ip', '-j', 'addr', 'show'], text=True, stderr=subprocess.DEVNULL))
        for iface in addrs:
            for a in iface.get('addr_info', []):
                if a.get('family') == 'inet' and a.get('local') and a.get('prefixlen'):
                    try:
                        net_obj = ipaddress.ip_network(f"{a['local']}/{a['prefixlen']}", strict=False)
                        if net_obj.prefixlen > 1 and net_obj not in owned:
                            occupied.append(net_obj)
                    except Exception:
                        pass
    except Exception:
        pass

def is_free(net):
    return not any(net.overlaps(o) for o in occupied)

if raw_arg:
    try:
        req_net = ipaddress.ip_network(raw_arg, strict=False)
        if is_free(req_net):
            base = str(req_net.network_address).rsplit('.', 1)[0]
            print(f"{req_net} {base}.53 {base}.10 UNCHANGED")
            sys.exit(0)
    except Exception:
        pass
else:
    try:
        req_net = ipaddress.ip_network('172.30.1.0/24')
        if is_free(req_net):
            print("172.30.1.0/24 172.30.1.53 172.30.1.10 NEW")
            sys.exit(0)
    except Exception:
        pass

candidates = itertools.chain(
    (f'172.30.{x}.0/24' for x in range(1, 255)),
    (f'172.28.{x}.0/24' for x in range(1, 255)),
    (f'172.29.{x}.0/24' for x in range(1, 255)),
    (f'172.31.{x}.0/24' for x in range(1, 255)),
    (f'10.220.{x}.0/24' for x in range(1, 255)),
    (f'10.221.{x}.0/24' for x in range(1, 255)),
    (f'10.222.{x}.0/24' for x in range(1, 255)),
    (f'192.168.{x}.0/24' for x in range(100, 255)),
)

for c in candidates:
    cand_net = ipaddress.ip_network(c)
    if is_free(cand_net):
        base = str(cand_net.network_address).rsplit('.', 1)[0]
        status = "CHANGED" if raw_arg else "NEW"
        print(f"{cand_net} {base}.53 {base}.10 {status}")
        sys.exit(0)

base = req_subnet.rsplit('.', 1)[0]
print(f"{req_subnet} {base}.53 {base}.10 UNCHANGED")
PYCODE
)
  if [[ -n "$subnet_out" ]]; then
    read -r auto_subnet auto_resolver_ip auto_valkey_ip auto_subnet_status <<<"$subnet_out"
    if [[ "$auto_subnet_status" == "CHANGED" ]]; then
      existing["MGATE_BACKEND_SUBNET"]="$auto_subnet"
      existing["MGATE_RESOLVER_IP"]="$auto_resolver_ip"
      existing["MGATE_VALKEY_IP"]="$auto_valkey_ip"
      echo "note: resolved network overlap: updated MGATE_BACKEND_SUBNET=$auto_subnet (resolver=$auto_resolver_ip, valkey=$auto_valkey_ip)"
    fi
  fi
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
    elif [[ "$key" == "MGATE_BACKEND_SUBNET" && -n "$auto_subnet" ]]; then
      printf '%s=%s\n' "$key" "$auto_subnet" >>"$tmp_out"
    elif [[ "$key" == "MGATE_RESOLVER_IP" && -n "$auto_resolver_ip" ]]; then
      printf '%s=%s\n' "$key" "$auto_resolver_ip" >>"$tmp_out"
    elif [[ "$key" == "MGATE_VALKEY_IP" && -n "$auto_valkey_ip" ]]; then
      printf '%s=%s\n' "$key" "$auto_valkey_ip" >>"$tmp_out"
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
