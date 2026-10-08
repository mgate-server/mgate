# syntax=docker/dockerfile:1
#
# MGate Unbound image: DNSSEC-validating, recursive-only resolver used by
# every other mail container (`dns: [${MGATE_RESOLVER_IP:-172.30.1.53}]`).
# Deliberately never forwards to a public resolver: DNSBL zones (Spamhaus et al.) explicitly forbid resolving
# through shared/public forwarders, and recursion also gives real DNSSEC
# validation instead of trusting an upstream's AD bit.
#
# Base pinned to debian:trixie-slim (checked against Docker Hub 2026-09-12:
# trixie-slim tracks Debian 13 point releases; a dated tag would pin tighter
# but this project pins the same rolling tag everywhere else, so we match it
# for consistency).
FROM debian:trixie-slim
ARG MGATE_VERSION=dev

# unbound          -- the resolver itself (1.22.x in trixie, checked via apt-cache policy)
# unbound-anchor   -- manual/operator tool to (re)bootstrap the root trust anchor;
#                     NOT used automatically at every start (see docker-entrypoint.sh
#                     for why: dns-root-data's shipped root.key is our default seed)
# dns-root-data    -- ships /usr/share/dns/root.{key,ds,hints}, kept current via
#                     normal Debian security updates -- our offline bootstrap seed
# ldnsutils        -- provides `drill`, used by HEALTHCHECK and for manual DNSSEC debugging
# gettext-base     -- provides `envsubst`, used to render unbound.conf from the template
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        unbound \
        unbound-anchor \
        dns-root-data \
        ldnsutils \
        gettext-base \
    && rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/unbound /etc/unbound/conf.d && \
    chown unbound:unbound /var/lib/unbound
# ^ /etc/unbound/conf.d is the operator extension point: the rendered config
# ends with `include-toplevel: "/etc/unbound/conf.d/*.conf"`. It ships empty
# (root-owned, 0755 -- readable by the `unbound` user); operators bind-mount
# their own *.conf files there read-only. See docker/unbound/README.md.

COPY docker/unbound/unbound.conf.template /etc/unbound/unbound.conf.template
COPY docker/unbound/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker/unbound/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/healthcheck.sh && \
    rm -f /etc/unbound/unbound.conf.d/root-auto-trust-anchor-file.conf
# ^ the Debian package's own unbound.conf.d snippet also sets auto-trust-anchor-file,
# but our template already sets it explicitly and never includes Debian's
# unbound.conf.d/* (we include only our own /etc/unbound/conf.d, see above) --
# removing it avoids a dangling reference/confusion.

# Binding UDP/TCP port 53 needs CAP_NET_BIND_SERVICE when running as a
# non-root user; the compose/infra layer must add it for this service:
#   cap_add: [NET_BIND_SERVICE]
# (documented in docs/mail/antivirus-dns.md). We run as the unprivileged
# `unbound` user created by the Debian package -- never as root.
LABEL org.opencontainers.image.title="mgate-unbound" \
      org.opencontainers.image.description="Recursive DNSSEC-validating resolver for the MGate mail stack (Unbound), with an extension point for private-zone forwarding." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

USER unbound

EXPOSE 53/udp 53/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/usr/local/bin/healthcheck.sh"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Rendered config lands in /var/lib/unbound/unbound.conf (writable by the
# `unbound` user) -- see docker-entrypoint.sh; /etc/unbound only holds the
# read-only template copied in at build time.
CMD ["-d", "-c", "/var/lib/unbound/unbound.conf"]
