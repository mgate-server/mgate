#!/bin/sh
# entrypoint.sh — renders /config.json from env, then execs the container's real command
# (nginx). Runs as the non-root nginx user (uid 101) set in docker/web/Dockerfile.
#
# Shape matches web/apps/spa/src/lib/runtimeConfig.ts's RuntimeConfig interface exactly —
# keep the two in sync.
set -eu

# Written to /tmp, not into /usr/share/nginx/html: the container runs with a read-only root
# filesystem (docker-compose.yml `web` service), so only tmpfs-backed /tmp is writable at
# runtime. nginx.conf serves this path at /config.json via `alias`.
CONFIG_PATH="/tmp/config.json"

# No JSON library in this image on purpose (keeps the runtime image minimal); values here are
# operator-controlled env vars, not untrusted input, but are still escaped defensively.
json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

api_base_url="$(json_escape "${MGATE_API_BASE_URL:-}")"

# Optional vendor links (pricing page / vendor portal): each key is emitted only when its env
# var is non-empty; the whole "links" object is omitted when both are empty. The SPA shows the
# matching buttons/links only when the URL is configured.
links_json=""
if [ -n "${MGATE_PRICING_URL:-}" ] || [ -n "${MGATE_VENDOR_PORTAL_URL:-}" ]; then
    links_fields=""
    if [ -n "${MGATE_PRICING_URL:-}" ]; then
        links_fields="\"pricingUrl\":\"$(json_escape "${MGATE_PRICING_URL}")\""
    fi
    if [ -n "${MGATE_VENDOR_PORTAL_URL:-}" ]; then
        [ -n "$links_fields" ] && links_fields="${links_fields},"
        links_fields="${links_fields}\"vendorPortalUrl\":\"$(json_escape "${MGATE_VENDOR_PORTAL_URL}")\""
    fi
    links_json=",\"links\":{${links_fields}}"
fi

cat >"$CONFIG_PATH" <<EOF
{"apiBaseUrl":"${api_base_url}"${links_json}}
EOF

exec "$@"
