# docker/firewall/Dockerfile — nftables + `mgate-agent --role firewall`.
# `network_mode: host` + `cap_add: [NET_ADMIN, NET_RAW]` (docker-compose.yml, profile `firewall`):
# the agent subscribes to Valkey's `mgate:bans`/`mgate:bans:events` and keeps the nftables set
# `mgate_ban` in sync. The base ruleset (table/chain/set) is loaded once at start;
# mgate-agent only ever adds/removes *elements* of the `mgate_ban` set at runtime.
#
# Built from source by `docker compose -f docker-compose.yml -f docker-compose.build.yml
# --profile firewall build firewall` (make image-firewall).
#
# The mgate-agent binary is not built in this repository: it ships only as the tiny
# ghcr.io/mgate-server/mgate-agent image (part of the closed backend distribution). This
# Dockerfile copies the binary out of that image via BuildKit's named-image COPY --from, so
# building this image needs no Rust toolchain and no backend sources.

ARG MGATE_VERSION=dev
ARG MGATE_AGENT_IMAGE=ghcr.io/mgate-server/mgate-agent:${MGATE_VERSION}

# Named-image stage so the final stage's `COPY --from=mgate-agent` works: this BuildKit's
# `docker/dockerfile:1.7` frontend does not expand an ARG directly inside `COPY --from=` (tested
# 2026-09-12, buildx 0.12.1/BuildKit-in-docker 25.0.2 — "variable expansion is not supported for
# --from"); a `FROM ${ARG} AS <name>` stage is the documented workaround and works on every
# BuildKit version.
FROM ${MGATE_AGENT_IMAGE} AS mgate-agent

FROM debian:trixie-slim AS runtime
ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-firewall" \
      org.opencontainers.image.description="nftables ban-list enforcement for MGate: keeps an nftables set in sync with the MGate ban list. Runs on the host network." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

# hadolint ignore=DL3008
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends nftables ca-certificates; \
    rm -rf /var/lib/apt/lists/*

COPY --from=mgate-agent /usr/local/bin/mgate-agent /usr/local/bin/mgate-agent
COPY docker/firewall/nftables.conf /etc/mgate/nftables.conf
COPY docker/firewall/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

# Runs as root: nftables ruleset management requires NET_ADMIN/NET_RAW, which only work
# unprivileged-user-wise via file capabilities on `nft` that we do not set up here — root inside
# the container is the accepted trade-off for this single-purpose, host-networked, profile-gated
# service (see docker-compose.yml: cap_drop ALL + cap_add [NET_ADMIN, NET_RAW] still applies).
ENTRYPOINT ["/entrypoint.sh"]
CMD ["mgate-agent", "--role", "firewall"]
