#!/usr/bin/env bash
# validate-configs.sh — validate the compose files and the daemon configs baked into the
# first-party images, using each daemon's own config-check tool.
#
# No Rust source is ever built here (this repo has none): Postfix/Dovecot are
# built with `--target base`, which stops before the final stage's
# `COPY --from=${MGATE_AGENT_IMAGE}` and needs no agent image at all, then their init script
# renders the runtime config from a dummy environment and `postfix check` / `doveconf -n`
# validate the result (docs/mail/postfix.md §9, docs/mail/dovecot.md §13). Rspamd, Unbound,
# Traefik and Web are single-stage (or agent-free) images built in full (all with the repository
# root as build context, like docker-compose.build.yml). Also checks that the Helm chart's copy
# of the postgres initdb role script has not drifted from the original.
#
# Usage: ./scripts/validate-configs.sh            (all checks)
#        VALIDATE_ONLY="postfix dovecot" ./scripts/validate-configs.sh
# Env: MGATE_VALIDATE_ENV=<file> uses that env file for `docker compose config` instead of .env
#      (or a copy of .env.example when .env does not exist).
set -uo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

export DOCKER_BUILDKIT=1
fail_count=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

section() { echo; echo "== $* =="; }
ok()   { echo "  [OK]   $*"; }
fail() { echo "  [FAIL] $*" >&2; fail_count=$((fail_count + 1)); }
want() { [[ -z "${VALIDATE_ONLY:-}" || " ${VALIDATE_ONLY} " == *" $1 "* ]]; }

# Dummy secrets for config rendering only (never used to run anything reachable).
DUMMY_ENV=(
  -e MGATE_HOSTNAME=mail.example.com
  -e MGATE_ADMIN_EMAIL=admin@example.com
  -e POSTGRES_MAIL_PASSWORD=dummy-mail-password
  -e MGATE_INTERNAL_TOKEN=dummy-internal-token-0123456789abcdef
  -e DOVEADM_API_KEY=dummy-doveadm-key
  -e RSPAMD_CONTROLLER_PASSWORD=dummy-controller-password
)

# --- postgres initdb parity -------------------------------------------------------------------
# The Helm chart ships its own copy of this script because `.Files.Get` cannot read files outside
# the chart directory — make sure the two never drift apart.
if want initdb; then
  section "docker/postgres/initdb vs. deploy/helm/mgate: 10-create-mail-role.sh parity"
  a="docker/postgres/initdb/10-create-mail-role.sh"
  b="deploy/helm/mgate/files/postgres-initdb/10-create-mail-role.sh"
  if diff -u "$a" "$b" >"$work/initdb.diff" 2>&1; then
    ok "$a matches $b"
  else
    fail "$a and $b diverged (Helm cannot read files outside the chart dir, so it keeps its own copy):"
    cat "$work/initdb.diff" >&2
  fi
fi

# --- compose ---------------------------------------------------------------------------------
if want compose; then
  env_file="${MGATE_VALIDATE_ENV:-}"
  if [[ -z "$env_file" ]]; then
    if [[ -f .env ]]; then env_file=.env; else env_file="$work/env"; cp .env.example "$env_file"; fi
  fi
  section "docker compose config (distribution, build, dev overlays; every profile)"
  for files in "docker-compose.yml" \
               "docker-compose.yml docker-compose.build.yml" \
               "docker-compose.yml docker-compose.build.yml docker-compose.dev.yml"; do
    args=()
    for f in $files; do args+=(-f "$f"); done
    for profiles in "" "clamav" "clamav,backup,restore,firewall"; do
      label="${files} [profiles=${profiles:-none}]"
      if COMPOSE_PROFILES="$profiles" docker compose --env-file "$env_file" "${args[@]}" \
          config -q 2>"$work/err"; then
        ok "$label"
      else
        fail "$label: $(cat "$work/err")"
      fi
    done
  done
fi

# build_image <name> <dockerfile> [--target base]
build_image() {
  local name="$1" dockerfile="$2"; shift 2
  local tag="mgate-validate/$name:tmp"
  if docker build -q "$@" -t "$tag" -f "$dockerfile" . >"$work/build-$name.log" 2>&1; then
    echo "$tag"
    return 0
  fi
  fail "docker build $* -f $dockerfile failed:"
  tail -30 "$work/build-$name.log" >&2
  return 1
}

# run_check <name> <tag> <shell command> [docker run args...]
run_check() {
  local name="$1" tag="$2" cmd="$3"; shift 3
  if docker run --rm "$@" "$tag" -c "$cmd" >"$work/run-$name.log" 2>&1; then
    ok "$name: $cmd"
  else
    fail "$name: $cmd"
    tail -30 "$work/run-$name.log" >&2
  fi
}

if want web; then
  section "docker/web: nginx -t + start-up smoke check"
  if tag="$(build_image web docker/web/Dockerfile)"; then
    if docker run --rm --entrypoint sh "$tag" -c 'nginx -t' >"$work/run-web-syntax.log" 2>&1; then
      ok "web: nginx -t"
    else
      fail "web: nginx -t"
      tail -30 "$work/run-web-syntax.log" >&2
    fi
    # Full start-up under the exact hardening docker-compose.yml applies (read-only root fs,
    # non-root uid, no capabilities): proves the tmpfs/permissions story in the Dockerfile and
    # nginx.conf actually works, not just that the config parses.
    cid="$(docker run -d --read-only --tmpfs /tmp --tmpfs /var/cache/nginx:mode=1777 \
      --cap-drop ALL --user 101:101 -e MGATE_API_BASE_URL=https://mail.example.com "$tag")"
    sleep 2
    if [[ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" == "true" ]] \
        && docker exec "$cid" wget -q -O- http://127.0.0.1:8080/config.json | grep -q apiBaseUrl \
        && docker exec "$cid" wget -q -O /dev/null http://127.0.0.1:8080/some/spa/route; then
      ok "web: started read-only/non-root, served /config.json and the SPA fallback"
    else
      fail "web: did not start cleanly, or /config.json / SPA fallback did not respond"
      docker logs "$cid" 2>&1 | tail -30 >&2
    fi
    docker rm -f "$cid" >/dev/null 2>&1 || true
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

if want postfix; then
  section "docker/postfix (--target base): mgate-postfix-init + postfix check"
  if tag="$(build_image postfix docker/postfix/Dockerfile --target base)"; then
    run_check postfix "$tag" \
      'mgate-postfix-init && postfix check && postconf -n >/dev/null && postconf -M >/dev/null' \
      --entrypoint bash "${DUMMY_ENV[@]}"
    run_check "postfix (Spamhaus DQS)" "$tag" \
      'mgate-postfix-init && postfix check && postconf postscreen_dnsbl_sites postscreen_dnsbl_reply_map | grep -q dqs12345' \
      --entrypoint bash "${DUMMY_ENV[@]}" -e MGATE_SPAMHAUS_DQS_KEY=dqs12345
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

if want dovecot; then
  section "docker/dovecot (--target base): mgate-dovecot-init + doveconf -n"
  if tag="$(build_image dovecot docker/dovecot/Dockerfile --target base)"; then
    run_check dovecot "$tag" 'mgate-dovecot-init && doveconf -n >/dev/null' \
      --entrypoint bash "${DUMMY_ENV[@]}"
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

if want rspamd; then
  section "docker/rspamd: rspamadm configtest"
  if tag="$(build_image rspamd docker/rspamd/Dockerfile)"; then
    # Rspamd only exposes RSPAMD_* variables to its config templates; the two secrets are
    # mandatory (config load fails without them, by design).
    run_check rspamd "$tag" 'rspamadm configtest' --entrypoint sh \
      -e RSPAMD_CONTROLLER_PASSWORD=dummy-controller-password \
      -e RSPAMD_INTERNAL_TOKEN=dummy-internal-token-0123456789abcdef \
      -e RSPAMD_REDIS_PASSWORD=dummy -e RSPAMD_MESSAGE_SIZE_LIMIT=52428800
    # `rspamadm configtest` exits 0 even when it only warns, so a task_timeout regression
    # vs. the symbols cache (docker/rspamd/local.d/options.inc) would pass silently otherwise.
    if [[ -f "$work/run-rspamd.log" ]] && grep -q 'is less than maximum symbols cache timeout' "$work/run-rspamd.log"; then
      fail "rspamd: task_timeout is less than maximum symbols cache timeout (see options.inc)"
      grep 'is less than maximum symbols cache timeout' "$work/run-rspamd.log" >&2
    fi
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

if want unbound; then
  section "docker/unbound: render template + unbound-checkconf"
  if tag="$(build_image unbound docker/unbound/Dockerfile)"; then
    # Same steps as docker-entrypoint.sh (seed the trust anchor, render), then check.
    run_check unbound "$tag" \
      "cp /usr/share/dns/root.key /var/lib/unbound/root.key && envsubst '\$MGATE_BACKEND_SUBNET \$LOG_LEVEL' </etc/unbound/unbound.conf.template >/var/lib/unbound/unbound.conf && unbound-checkconf /var/lib/unbound/unbound.conf" \
      --entrypoint sh -e MGATE_BACKEND_SUBNET=172.30.1.0/24 -e LOG_LEVEL=1
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

if want traefik; then
  section "docker/traefik: static + dynamic config load"
  if tag="$(build_image traefik docker/traefik/Dockerfile)"; then
    # Start Traefik for a few seconds with the baked routes and check it logs no error-level
    # line (bad static/dynamic config, unknown TLS options, ...).
    cid="$(docker run -d -e MGATE_HOSTNAME=mail.example.com "$tag")"
    sleep 4
    logs="$(docker logs "$cid" 2>&1)"
    running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)"
    docker rm -f "$cid" >/dev/null 2>&1 || true
    if [[ "$running" != "true" ]]; then
      fail "traefik exited on startup: $(tail -5 <<<"$logs")"
    elif grep -Eq '"level":"(error|fatal|panic)"' <<<"$logs"; then
      fail "traefik logged errors: $(grep -E '"level":"(error|fatal|panic)"' <<<"$logs" | head -5)"
    else
      ok "traefik started without error-level log lines"
    fi
    docker image rm -f "$tag" >/dev/null 2>&1 || true
  fi
fi

echo
echo "validate-configs: ${fail_count} failed."
[[ $fail_count -eq 0 ]]
