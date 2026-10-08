# docker/traefik/Dockerfile — Traefik with MGate's static config and route templates baked in.
# Dynamic routes are copied into the shared `proxy-dynamic` volume by entrypoint.sh on start (so
# they survive next to whatever mgate itself writes there, e.g. 10-certs.yml) rather than being
# read directly from the image — Traefik's file provider watches the volume, not the image layer.
ARG TRAEFIK_VERSION=v3.7.13
FROM traefik:${TRAEFIK_VERSION}
ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-traefik" \
      org.opencontainers.image.description="Traefik reverse proxy preconfigured for MGate: static config and route templates baked in." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

COPY docker/traefik/traefik.yml /etc/traefik/traefik.yml
COPY docker/traefik/dynamic/00-routes.yml /opt/mgate/traefik/00-routes.yml
COPY docker/traefik/entrypoint.sh /entrypoint.sh

# Mount points of the shared volumes, owned by uid 10001 (compose runs traefik and mgate as
# 10001:10001): a fresh named volume copies this ownership, so whichever container mounts it first
# leaves it writable for entrypoint.sh (00-routes.yml) and mgate (10-certs.yml, /certs).
RUN mkdir -p /etc/traefik/dynamic /certs \
 && chown 10001:10001 /etc/traefik/dynamic /certs \
 && chmod 0755 /entrypoint.sh

# docker-compose.yml runs this image as 10001:10001 (read-only root fs, NET_BIND_SERVICE only).
ENTRYPOINT ["/entrypoint.sh"]
CMD ["traefik"]
