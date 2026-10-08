# syntax=docker/dockerfile:1.7
# MGate Postfix image: Postfix 3.10 (Debian trixie) + mgate-agent, supervised by s6-overlay v3.
# Build context = repository root:
#   docker build -f docker/postfix/Dockerfile -t mgate-postfix .
#   docker build -f docker/postfix/Dockerfile --target base .   # configs only, no agent binary
# Docs: docs/mail/postfix.md
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
# base: packages, s6-overlay, configs and scripts - everything except the agent binary.
# ---------------------------------------------------------------------------------------------
FROM ${DEBIAN_IMAGE} AS base
ARG TARGETARCH
# s6-overlay release and per-arch sha256 (https://github.com/just-containers/s6-overlay/releases)
ARG S6_OVERLAY_VERSION=3.2.3.2
ARG S6_OVERLAY_NOARCH_SHA256=5379750ed30a84bbd2e2dd74847ba6b5bd29cd0b2e3ea2ec58049b57eb2eda12
ARG S6_OVERLAY_X86_64_SHA256=e6befcc96a437a3831386ecfc51808c5d3e939dc5fe3c02ae9284599e8aa2408
ARG S6_OVERLAY_AARCH64_SHA256=b17f17a82e7a515c682a91edaf2ffdabb73f891981b6c1fd712115693a2f8b4c

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
        postfix postfix-pgsql \
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

# Drop Debian's example configuration; ours is complete.
RUN rm -f /etc/postfix/main.cf /etc/postfix/master.cf /etc/postfix/main.cf.proto /etc/postfix/master.cf.proto \
 && install -d -m 0750 -o root -g postfix /etc/postfix/pgsql

COPY docker/postfix/rootfs/ /
RUN chmod 0755 /usr/local/bin/mgate-postfix-init /usr/local/bin/mgate-healthcheck \
        /etc/s6-overlay/s6-rc.d/*/run \
 && chmod 0644 /usr/local/lib/mgate/common.sh \
 && find /etc/postfix /usr/local/share/mgate -type f -exec chmod go-w {} +

# s6-overlay: stop the container if init fails; no global timeout for the init oneshot
# (bootstrap cert generation may wait for the dovecot container's lock); allow postfix to
# finish in-flight SMTP sessions on stop (compose stop_grace_period must be larger).
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=20000 \
    S6_KILL_GRACETIME=5000 \
    S6_VERBOSITY=1 \
    POSTGRES_HOST=postgres \
    MGATE_MESSAGE_SIZE_LIMIT=52428800 \
    MGATE_BACKEND_SUBNET=172.30.1.0/24

# 25 smtp (postscreen), 465 submissions, 587 submission; backend only: 2587 internal submission
# for the webmail gateway, 7070 mgate-agent control
EXPOSE 25 465 587 2587 7070
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["/usr/local/bin/mgate-healthcheck"]
ENTRYPOINT ["/init"]

# ---------------------------------------------------------------------------------------------
# final image
# ---------------------------------------------------------------------------------------------
FROM base AS final
ARG MGATE_VERSION=dev
COPY --from=mgate-agent /usr/local/bin/mgate-agent /usr/local/bin/mgate-agent
LABEL org.opencontainers.image.title="mgate-postfix" \
      org.opencontainers.image.description="MGate MTA: Postfix 3.10 with a supervising MGate agent (syslog, certificate reload, control API). Part of the MGate mail server." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"
