# syntax=docker/dockerfile:1
#
# MGate Rspamd image: upstream Rspamd 4.x with mgate-specific local.d/override.d
# configuration baked in. Secrets and per-deployment values are injected at
# container start through Rspamd's built-in Jinja-like config templating,
# which exposes OS environment variables prefixed `RSPAMD_` as `env.*` inside
# every config file (see docs/mail/rspamd.md and
# https://docs.rspamd.com/configuration/templates/ for the exact syntax).
#
# Pinned tag verified against Docker Hub on 2026-09-12 (rspamd/rspamd tags
# include 4.1, 4.1.5, ...). We pin the full patch version for reproducible
# builds; bump deliberately together with docs/mail/rspamd.md.
FROM rspamd/rspamd:4.1.5

# Config lives under /etc/rspamd/local.d (soft overrides, merged with stock
# defaults) and /etc/rspamd/override.d (hard overrides, replace stock section
# entirely). We only ship local.d/override.d fragments -- never touch
# /etc/rspamd/rspamd.conf itself, so upstream security fixes to the base
# config keep applying on image rebuilds.
COPY docker/rspamd/local.d/ /etc/rspamd/local.d/
COPY docker/rspamd/override.d/ /etc/rspamd/override.d/

# rspamd/rspamd upstream image already runs as the unprivileged `_rspamd`
# user (see upstream Dockerfile) and owns /etc/rspamd, /var/lib/rspamd; we
# do not change the user here.

# Controller worker exposes an HTTP /ping endpoint that does not require
# authentication and is cheap; used for the container healthcheck. See
# https://rspamd.com/developers/controller_endpoints (via docs.rspamd.com).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD rspamc -h 127.0.0.1:11334 stat >/dev/null 2>&1 || exit 1

EXPOSE 11332 11333 11334

ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-rspamd" \
      org.opencontainers.image.description="Rspamd spam filter preconfigured for MGate: milter, antivirus and DKIM/ARC/DMARC settings baked in." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"
