# syntax=docker/dockerfile:1.7
# MGate Dovecot image: Dovecot 2.4 + Pigeonhole (Debian trixie) + mgate-agent, supervised by
# s6-overlay v3. Build context = repository root:
#   docker build -f docker/dovecot/Dockerfile -t mgate-dovecot .
#   docker build -f docker/dovecot/Dockerfile --target base .   # configs only, no agent binary
# Docs: docs/mail/dovecot.md
#
# The mgate-agent binary is not built in this repository: it ships only as the tiny
# ghcr.io/mgate-server/mgate-agent image (part of the closed backend distribution). This
# Dockerfile copies the binary out of that image via BuildKit's named-image COPY --from, so
# building this image needs no Rust toolchain and no backend sources.

ARG DEBIAN_IMAGE=debian:trixie-slim
ARG MGATE_VERSION=dev
ARG MGATE_AGENT_IMAGE=ghcr.io/mgate-server/mgate-agent:${MGATE_VERSION}

# Named-image stage so the final stage's `COPY --from=mgate-agent` works: this BuildKit's
# `docker/dockerfile:1.7` frontend does not expand an ARG directly inside `COPY --from=` (tested
# 2026-09-12, buildx 0.12.1/BuildKit-in-docker 25.0.2 — "variable expansion is not supported for
# --from"); a `FROM ${ARG} AS <name>` stage is the documented workaround and works on every
# BuildKit version.
FROM ${MGATE_AGENT_IMAGE} AS mgate-agent

# ---------------------------------------------------------------------------------------------
# base: packages, s6-overlay, configs, compiled global Sieve scripts - all but the agent binary.
# ---------------------------------------------------------------------------------------------
FROM ${DEBIAN_IMAGE} AS base
ARG TARGETARCH
# s6-overlay release and per-arch sha256 (https://github.com/just-containers/s6-overlay/releases)
ARG S6_OVERLAY_VERSION=3.2.3.2
ARG S6_OVERLAY_NOARCH_SHA256=5379750ed30a84bbd2e2dd74847ba6b5bd29cd0b2e3ea2ec58049b57eb2eda12
ARG S6_OVERLAY_X86_64_SHA256=e6befcc96a437a3831386ecfc51808c5d3e939dc5fe3c02ae9284599e8aa2408
ARG S6_OVERLAY_AARCH64_SHA256=b17f17a82e7a515c682a91edaf2ffdabb73f891981b6c1fd712115693a2f8b4c
ARG VMAIL_UID=5000
ARG VMAIL_GID=5000

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# vmail must exist before the packages so file ownership is stable (uid/gid 5000).
RUN groupadd --system --gid "${VMAIL_GID}" vmail \
 && useradd --system --uid "${VMAIL_UID}" --gid vmail --home-dir /var/vmail --no-create-home \
        --shell /usr/sbin/nologin vmail \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
        dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd dovecot-pgsql \
        dovecot-sieve dovecot-managesieved dovecot-auth-lua dovecot-flatcurve \
        lua-json \
        ca-certificates openssl curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH:-amd64}" in \
        amd64) s6_arch=x86_64;  s6_sha="${S6_OVERLAY_X86_64_SHA256}" ;; \
        arm64) s6_arch=aarch64; s6_sha="${S6_OVERLAY_AARCH64_SHA256}" ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}" \
 && curl -fsSL -o /tmp/s6-noarch.tar.xz "${base}/s6-overlay-noarch.tar.xz" \
 && curl -fsSL -o /tmp/s6-arch.tar.xz "${base}/s6-overlay-${s6_arch}.tar.xz" \
 && echo "${S6_OVERLAY_NOARCH_SHA256}  /tmp/s6-noarch.tar.xz" | sha256sum -c - \
 && echo "${s6_sha}  /tmp/s6-arch.tar.xz" | sha256sum -c - \
 && tar -C / -Jxpf /tmp/s6-noarch.tar.xz \
 && tar -C / -Jxpf /tmp/s6-arch.tar.xz \
 && rm -f /tmp/s6-*.tar.xz

# Drop Debian's example configuration (conf.d, generated snakeoil cert); ours is complete.
RUN rm -rf /etc/dovecot/conf.d /etc/dovecot/private /etc/dovecot/dovecot.conf \
 && install -d -m 0755 /etc/dovecot/conf.d /etc/dovecot/mgate /var/vmail

# Shared init helpers live in the postfix image tree (single source of truth).
COPY docker/postfix/rootfs/usr/local/lib/mgate/common.sh /usr/local/lib/mgate/common.sh
COPY docker/dovecot/rootfs/ /
RUN chmod 0755 /usr/local/bin/mgate-dovecot-init /usr/local/bin/mgate-healthcheck \
        /usr/local/lib/dovecot/sieve-pipe/rspamd-learn /etc/s6-overlay/s6-rc.d/*/run \
 && find /etc/dovecot /usr/local/lib/mgate -type f -exec chmod go-w {} + \
 && chown vmail:vmail /var/vmail && chmod 0750 /var/vmail \
 && doveconf -n >/dev/null \
 && for s in /etc/dovecot/sieve/before.d/*.sieve /etc/dovecot/sieve/*.sieve; do sievec "$s"; done \
 && chmod 0644 /etc/dovecot/sieve/*.svbin /etc/dovecot/sieve/before.d/*.svbin

# s6-overlay: stop the container if init fails; no global init timeout (bootstrap cert may
# wait for the postfix container's lock); give Dovecot time to close sessions on stop.
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=15000 \
    S6_KILL_GRACETIME=5000 \
    S6_VERBOSITY=1 \
    POSTGRES_HOST=postgres \
    MGATE_BACKEND_SUBNET=172.30.1.0/24

# public: 143 imap, 993 imaps, 110 pop3, 995 pop3s, 4190 managesieve
# backend: 1143 imap (webmail gateway only), 24 lmtp, 12345 auth (SASL), 12340 quota-status,
#          8080 doveadm API, 9900 metrics, 7070 mgate-agent control
EXPOSE 143 993 110 995 4190 1143 24 12345 12340 8080 9900 7070
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["/usr/local/bin/mgate-healthcheck"]
ENTRYPOINT ["/init"]

# ---------------------------------------------------------------------------------------------
# final image
# ---------------------------------------------------------------------------------------------
FROM base AS final
ARG MGATE_VERSION=dev
COPY --from=mgate-agent /usr/local/bin/mgate-agent /usr/local/bin/mgate-agent
LABEL org.opencontainers.image.title="mgate-dovecot" \
      org.opencontainers.image.description="MGate IMAP/POP3/LMTP/Sieve server: Dovecot 2.4 with Pigeonhole and a supervising MGate agent. Part of the MGate mail server." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"
