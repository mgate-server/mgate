#!/usr/bin/env sh
# MGate Unbound entrypoint: render unbound.conf from the template (env
# substitution) and seed the DNSSEC root trust anchor, then exec unbound.
#
# Runs as the unprivileged `unbound` user (see Dockerfile `USER unbound`) --
# every path touched here must already be writable by that user; nothing
# in this script ever needs root.
set -eu

: "${MGATE_BACKEND_SUBNET:=172.30.1.0/24}"
: "${LOG_LEVEL:=1}"
export MGATE_BACKEND_SUBNET LOG_LEVEL

RENDERED_CONF="/var/lib/unbound/unbound.conf"
# shellcheck disable=SC2016 # literal variable list for envsubst, not an expansion
envsubst '$MGATE_BACKEND_SUBNET $LOG_LEVEL' \
    < /etc/unbound/unbound.conf.template \
    > "${RENDERED_CONF}"

# Root trust anchor bootstrap. We seed from dns-root-data's
# /usr/share/dns/root.key (kept current via ordinary Debian security
# updates -- no network call needed at container start) rather than
# running `unbound-anchor -a ...` here every boot, which would otherwise
# require reaching IANA over HTTPS before the resolver can even start.
# Unbound's own RFC 5011 auto-trust-anchor-file logic keeps this file
# updated once the resolver is running, so the seed only matters for a
# brand-new/empty state.
#
# docker-compose.yml mounts the `unbound-data` volume at /var/lib/unbound, so
# the seed fires once per volume lifetime and the RFC 5011 rolled state
# persists across container recreation (without a volume it reruns on every
# recreation, which is harmless: same trusted seed each time).
if [ ! -s /var/lib/unbound/root.key ]; then
    cp /usr/share/dns/root.key /var/lib/unbound/root.key
fi

exec unbound "$@"
