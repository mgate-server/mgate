# shellcheck shell=bash
# Shared helpers for MGate mail container init scripts (postfix + dovecot images).
# Sourced, never executed. Single source of truth: docker/postfix/rootfs/usr/local/lib/mgate/common.sh
# (the dovecot Dockerfile copies this same file).

MGATE_COMPONENT="${MGATE_COMPONENT:-mail}"

log()  { printf '[mgate-init/%s] %s\n' "$MGATE_COMPONENT" "$*" >&2; }
warn() { log "WARNING: $*"; }
die()  { log "FATAL: $*"; exit 1; }

# require_env NAME... : fail fast when a mandatory variable is empty.
require_env() {
    local name missing=()
    for name in "$@"; do
        [ -n "${!name:-}" ] || missing+=("$name")
    done
    [ "${#missing[@]}" -eq 0 ] || die "missing required environment variable(s): ${missing[*]}"
}

# is_uint VALUE : true when VALUE is a non-negative decimal integer.
is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

# write_file PATH MODE OWNER:GROUP : atomically write stdin to PATH with the given mode/owner.
# The temp file is created in the target directory so the final rename is atomic.
write_file() {
    local path="$1" mode="$2" owner="$3" dir tmp
    dir="$(dirname "$path")"
    install -d -m 0755 "$dir"
    tmp="$(mktemp "$dir/.mgate.XXXXXX")"
    cat >"$tmp"
    chown "$owner" "$tmp"
    chmod "$mode" "$tmp"
    mv -f "$tmp" "$path"
}

# write_secret PATH GROUP : secrets are root-owned, group-readable by the service group only (0640).
write_secret() { write_file "$1" 0640 "root:$2"; }

# dovecot_quote VALUE : render VALUE as a double-quoted Dovecot config string.
dovecot_quote() {
    local v="$1"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    printf '"%s"' "$v"
}

# check_secret_charset NAME : secrets end up in config files and URLs; gen-secrets.sh produces
# URL-safe values. Reject characters that would need context-specific escaping everywhere.
check_secret_charset() {
    local name="$1" value="${!1:-}"
    if [[ ! "$value" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
        die "$name contains characters outside [A-Za-z0-9._~+/=-]; regenerate it with scripts/gen-secrets.sh"
    fi
}

# ensure_bootstrap_cert : create a self-signed certificate for MGATE_HOSTNAME in /certs/default
# unless one exists. Safe when the postfix and dovecot containers start at the same time on a
# shared `certs` volume: an exclusive flock serialises generation, the existence check is
# repeated under the lock, and files are moved into place with atomic renames (key first, so a
# reader that sees the new fullchain always finds the matching key).
# The backend (its ACME module, uid 10001 in the mgate image) later replaces these files with
# atomic renames, so the directories and bootstrap files are handed to MGATE_CERTS_OWNER
# (default 10001:10001; empty = keep root). Root in the mail containers still reads them
# (CAP_DAC_OVERRIDE). mgate-agent watches /certs/default and reloads the daemon.
ensure_bootstrap_cert() {
    local certs_dir="${MGATE_CERTS_DIR:-/certs}" host="${MGATE_HOSTNAME:?}"
    local owner="${MGATE_CERTS_OWNER-10001:10001}"
    local dir="$certs_dir/default" lock tmp d
    lock="$certs_dir/.bootstrap.lock"

    install -d -m 0755 "$certs_dir" "$dir"
    # A fresh named volume is root-owned; hand the tree root to the certificate writer once.
    if [ -n "$owner" ]; then
        for d in "$certs_dir" "$dir"; do
            if [ "$(stat -c %u "$d")" = "0" ]; then
                chown "$owner" "$d"
            fi
        done
    fi
    if [ -s "$dir/fullchain.pem" ] && [ -s "$dir/privkey.pem" ]; then
        return 0
    fi

    (
        # 200: lock fd; wait up to 60s for the other container to finish generating.
        flock -w 60 200 || die "could not acquire $lock"
        if [ -s "$dir/fullchain.pem" ] && [ -s "$dir/privkey.pem" ]; then
            exit 0
        fi
        log "no certificate in $dir; generating self-signed bootstrap certificate for $host"
        tmp="$(mktemp -d "$dir/.bootstrap.XXXXXX")"
        trap 'rm -rf "$tmp"' EXIT
        openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
            -days 90 -subj "/CN=$host" \
            -addext "subjectAltName=DNS:$host" \
            -addext "basicConstraints=critical,CA:FALSE" \
            -addext "keyUsage=critical,digitalSignature" \
            -addext "extendedKeyUsage=serverAuth" \
            -keyout "$tmp/privkey.pem" -out "$tmp/fullchain.pem" 2>/dev/null \
            || die "openssl failed to create the bootstrap certificate"
        chmod 0600 "$tmp/privkey.pem"
        chmod 0644 "$tmp/fullchain.pem"
        # Marker so operators/mgate can tell the bootstrap cert from an issued one.
        printf 'self-signed bootstrap certificate for %s created %s\n' "$host" "$(date -u +%FT%TZ)" \
            >"$tmp/BOOTSTRAP"
        [ -z "$owner" ] || chown "$owner" "$tmp/privkey.pem" "$tmp/fullchain.pem" "$tmp/BOOTSTRAP"
        mv -f "$tmp/privkey.pem" "$dir/privkey.pem"
        mv -f "$tmp/fullchain.pem" "$dir/fullchain.pem"
        mv -f "$tmp/BOOTSTRAP" "$dir/BOOTSTRAP"
    ) 200>"$lock" || die "bootstrap certificate generation failed"
}

# wait_for_syslog_socket [TIMEOUT_SECONDS] : mgate-agent serves /dev/log. s6-rc starts it before
# the mail daemon, but binding the socket happens asynchronously, so wait briefly for it.
wait_for_syslog_socket() {
    local timeout="${1:-15}" i=0
    while [ ! -S /dev/log ]; do
        if [ "$i" -ge "$((timeout * 10))" ]; then
            warn "/dev/log not available after ${timeout}s (mgate-agent down?); daemon logs may be lost"
            return 1
        fi
        sleep 0.1
        i=$((i + 1))
    done
}
