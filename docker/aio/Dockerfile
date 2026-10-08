# docker/aio/Dockerfile — all-in-one image SKELETON (experimental). See README.md in this directory
# for the full design (which processes, s6-rc dependency graph, open questions).
#
# NOT part of `make images`/CI/`docker-compose.build.yml` — build explicitly with
# `make image-aio` if you want to poke at the skeleton. This stage only proves out the
# supervisor mechanism (s6-overlay boots, supervises one placeholder longrun, forwards signals);
# it does not run Postgres/Postfix/Dovecot/etc. Real per-process wiring is not done yet
# (TODO(S8)) and will COPY in configs/rootfs fragments from docker/postfix, docker/dovecot, docker/rspamd, etc.
# once those exist, plus the mgate binary (COPY --from=${MGATE_IMAGE}, the closed backend image
# ghcr.io/mgate-server/mgate) and the mgate-agent binary (COPY --from=${MGATE_AGENT_IMAGE}, same
# pattern as docker/postfix/Dockerfile and docker/firewall/Dockerfile).
FROM debian:trixie-slim AS s6-fetch
ARG S6_OVERLAY_VERSION=3.2.3.2
# hadolint ignore=DL3008
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /out; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) s6_arch=x86_64 ;; \
      arm64) s6_arch=aarch64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    curl -fsSL -o /tmp/noarch.tar.xz "${base}/s6-overlay-noarch.tar.xz"; \
    curl -fsSL -o /tmp/arch.tar.xz "${base}/s6-overlay-${s6_arch}.tar.xz"; \
    tar -C /out -Jxpf /tmp/noarch.tar.xz; \
    tar -C /out -Jxpf /tmp/arch.tar.xz

FROM debian:trixie-slim AS runtime
ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-aio" \
      org.opencontainers.image.description="MGate all-in-one image skeleton (s6-overlay supervisor only). Experimental, not for production use." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

COPY --from=s6-fetch /out/ /
COPY docker/aio/rootfs/ /

ENV S6_KEEP_ENV=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

ENTRYPOINT ["/init"]
