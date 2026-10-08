# syntax=docker/dockerfile:1.7
# MGate web image: nginx serving the built SPA (web/apps/spa) + a runtime /config.json rendered
# from env at container start — one image works for any hostname/branding
# without a rebuild.
# Build context = repository root:
#   docker build -f docker/web/Dockerfile -t mgate-web .
# Docs: docs/UI-DEVELOPMENT.md

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.29-alpine

# ---------------------------------------------------------------------------------------------
# build: npm workspaces install + production Vite build of apps/spa. Only manifest files are
# copied first so `npm ci` is cached across rebuilds that only touch source (docker layer cache).
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
# Product version, baked into the bundle (shown in the UI); the release pipeline passes the
# CalVer release number, local builds default to "dev".
ARG MGATE_VERSION=dev
WORKDIR /app
COPY web/package.json web/package-lock.json ./
COPY web/apps/spa/package.json apps/spa/package.json
COPY web/packages/ui/package.json packages/ui/package.json
COPY web/packages/api-client/package.json packages/api-client/package.json
COPY web/packages/extensions/package.json packages/extensions/package.json
RUN --mount=type=cache,id=mgate-web-npm,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY web/ .
ENV VITE_APP_VERSION=${MGATE_VERSION}
RUN npm run build -w apps/spa

# ---------------------------------------------------------------------------------------------
# final: nginx, non-root, listening on 8080. The image ships no secrets and no server-side
# logic — every real limit (domains, Pro features) is enforced by the closed backend, never
# here.
# ---------------------------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS final
ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-web" \
      org.opencontainers.image.description="MGate web UI: nginx serving the admin, account and webmail single-page app with a runtime-rendered /config.json." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

COPY docker/web/nginx.conf /etc/nginx/nginx.conf
COPY docker/web/entrypoint.sh /entrypoint.sh
COPY --from=build /app/apps/spa/dist /usr/share/nginx/html
# The built assets are served read-only (world-readable via COPY, no write needed at runtime —
# entrypoint.sh renders config.json into /tmp instead, see nginx.conf). /var/cache/nginx holds
# nginx's own temp buffers (client_temp, proxy_temp, ...): chown it for the non-root user set
# below in case this image is ever run without docker-compose.yml's tmpfs mounts; in compose,
# both /tmp and /var/cache/nginx are tmpfs (read-only root filesystem).
RUN chmod 0755 /entrypoint.sh \
 && chown -R 101:101 /var/cache/nginx

EXPOSE 8080
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
