# docker/backup/Dockerfile — restic + pg_dump + supercronic, scheduled via BACKUP_SCHEDULE.
#
# Base pinned to alpine:3.24 specifically (not the usual :3.22) because it is the first Alpine
# release whose repos carry `postgresql18-client` — matching `postgres:18-alpine`'s own server
# version. pg_dump must be >= the server's major version; anything older is not
# supported by upstream Postgres for a server this new. Verified on 2026-09-11: `apk search -x
# postgresql18-client` returns `18.6-r0` on alpine:3.24 and nothing on alpine:3.22.
FROM alpine:3.24
ARG MGATE_VERSION=dev
LABEL org.opencontainers.image.title="mgate-backup" \
      org.opencontainers.image.description="Scheduled backup and restore for MGate: restic and pg_dump, driven by a cron schedule." \
      org.opencontainers.image.source="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.url="https://github.com/mgate-server/mgate" \
      org.opencontainers.image.version="${MGATE_VERSION}" \
      org.opencontainers.image.vendor="MGate" \
      org.opencontainers.image.licenses="NOASSERTION"

# hadolint ignore=DL3018
RUN set -eux; \
    apk add --no-cache \
        restic \
        postgresql18-client \
        supercronic \
        bash \
        curl \
        ca-certificates \
        tzdata; \
    install -d -m 0700 -o root -g root /backups /var/lib/mgate-backup

COPY docker/backup/backup.sh /usr/local/bin/backup.sh
COPY docker/backup/restore.sh /usr/local/bin/restore.sh
COPY docker/backup/verify-backup.sh /usr/local/bin/verify-backup.sh
COPY docker/backup/crontab /etc/mgate/backup.crontab.tmpl
COPY docker/backup/entrypoint.sh /entrypoint.sh
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify-backup.sh /entrypoint.sh

# Root on purpose: the job is to read (backup) and write back (restore) the whole mail store,
# which belongs to vmail (5000:5000, 0750/0700 directories), and the certificate private keys.
# The orchestrator removes everything else: docker-compose.yml runs `backup` with cap_drop ALL +
# DAC_READ_SEARCH and read-only data mounts, and `restore` with DAC_OVERRIDE/CHOWN/FOWNER only;
# the Helm CronJob likewise keeps a single capability (see its template). The work directory and
# /backups are root-owned, so the compose backup needs no write-bypass capability at all.
# hadolint ignore=DL3002
USER 0:0
WORKDIR /var/lib/mgate-backup
VOLUME ["/backups"]

# Default: supercronic runs backup.sh on BACKUP_SCHEDULE. `make backup` runs
# `docker compose run --rm backup /usr/local/bin/backup.sh` and `make restore` runs
# `docker compose run --rm restore` (restore.sh) for an on-demand, non-scheduled run —
# entrypoint.sh execs whatever command it is given instead of supercronic.
ENTRYPOINT ["/entrypoint.sh"]
