#!/bin/sh
# entrypoint.sh — substitute ${MGATE_HOSTNAME} into the baked-in route template and copy it into
# the shared `proxy-dynamic` volume before handing off to Traefik. Runs on every container start
# (not just first boot) so a changed MGATE_HOSTNAME takes effect on restart; `mgate` (worker) owns
# /etc/traefik/dynamic/10-certs.yml in the same directory and is never touched from here.
set -eu

: "${MGATE_HOSTNAME:?MGATE_HOSTNAME must be set}"

src=/opt/mgate/traefik/00-routes.yml
dest_dir=/etc/traefik/dynamic
dest=${dest_dir}/00-routes.yml

mkdir -p "$dest_dir"
sed "s/\${MGATE_HOSTNAME}/${MGATE_HOSTNAME}/g" "$src" >"$dest"

echo "entrypoint: wrote ${dest} for MGATE_HOSTNAME=${MGATE_HOSTNAME}"

# Bootstrap TLS certificate. the backend (its ACME module) owns ${dest_dir}/10-certs.yml and writes it as
# soon as it has a certificate; until then Traefik falls back to its own throwaway
# "TRAEFIK DEFAULT CERT". The mail containers always generate a self-signed certificate for
# MGATE_HOSTNAME in /certs/default (marker file BOOTSTRAP), so publish that as the default
# certificate meanwhile - same paths and same `tls.stores.default` shape mgate writes later, so
# the two never disagree. Removed again as soon as 10-certs.yml exists.
bootstrap=${dest_dir}/05-bootstrap-certs.yml
if [ -f "${dest_dir}/10-certs.yml" ]; then
    rm -f "$bootstrap"
    echo "entrypoint: 10-certs.yml present (written by mgate); no bootstrap certificate file"
else
    wait_secs=${MGATE_TRAEFIK_CERT_WAIT:-20}
    while [ "$wait_secs" -gt 0 ] && [ ! -s /certs/default/fullchain.pem ]; do
        wait_secs=$((wait_secs - 1))
        sleep 1
    done
    if [ -s /certs/default/fullchain.pem ] && [ -s /certs/default/privkey.pem ]; then
        printf '%s\n' \
            '# Written by the traefik entrypoint: default certificate until mgate writes 10-certs.yml.' \
            'tls:' \
            '  stores:' \
            '    default:' \
            '      defaultCertificate:' \
            '        certFile: /certs/default/fullchain.pem' \
            '        keyFile: /certs/default/privkey.pem' \
            >"$bootstrap"
        echo "entrypoint: wrote ${bootstrap} (bootstrap certificate from /certs/default)"
    else
        echo "entrypoint: /certs/default/fullchain.pem missing; Traefik keeps its own default certificate"
    fi
fi

# Traefik's file provider watches /etc/traefik/dynamic with inotify and refuses to start at all
# when the host's fs.inotify.max_user_instances is exhausted ("couldn't initialize inotify: too
# many open files"), which would leave the proxy with no routes and no certificates. On such a
# host set MGATE_TRAEFIK_FILE_WATCH=false: the dynamic files are then read once at start, so
# `docker compose restart traefik` is needed after mgate writes a new 10-certs.yml.
# The root filesystem is read-only, so the patched static config goes to /tmp (tmpfs) and
# Traefik is pointed at it with --configFile.
if [ "${MGATE_TRAEFIK_FILE_WATCH:-true}" = "false" ]; then
    sed 's/^\( *\)watch: true/\1watch: false/' /etc/traefik/traefik.yml >/tmp/traefik.yml
    echo "entrypoint: file provider watch disabled (MGATE_TRAEFIK_FILE_WATCH=false)"
    exec "$@" --configFile=/tmp/traefik.yml
fi

exec "$@"
