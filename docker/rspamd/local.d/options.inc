## MGate: common options (docs/mail/rspamd.md)
##
## DNS resolution: the container's /etc/resolv.conf is written by Docker
## Compose (`dns: [${MGATE_RESOLVER_IP:-172.30.1.53}]` on every mail
## service), so leaving `dns.nameserver` unset makes Rspamd parse
## /etc/resolv.conf and talk to the mgate `unbound` service transparently
## (which in turn recurses + DNSSEC-validates; it never forwards to a
## public resolver, so Spamhaus/other DNSBL zones stay reachable). We do
## not hardcode a nameserver here on purpose -- see docker/unbound/.
dns {
    timeout = 1s;
    retransmits = 5;
    sockets = 16;
}

## Message size ceiling must track MGATE_MESSAGE_SIZE_LIMIT (bytes). The
## compose/infra layer must export it to this container as
## RSPAMD_MESSAGE_SIZE_LIMIT (Rspamd only exposes RSPAMD_-prefixed env vars
## to templates -- see https://docs.rspamd.com/configuration/templates/).
max_message = {= env.MESSAGE_SIZE_LIMIT | default "52428800" =};

## Networks that count as "local" for SPF/greylisting/ratelimit/etc. Must
## include the docker-compose `backend` network (${MGATE_BACKEND_SUBNET},
## default 172.30.1.0/24) so mail relayed internally (e.g. from webmail's
## SMTP submission, or Dovecot Sieve redirects) is not double-penalised.
## Rendered from RSPAMD_LOCAL_ADDRS (comma separated CIDRs) with an RFC1918
## fallback so `rspamadm configtest` passes even without the env var set.
local_addrs = "{= env.LOCAL_ADDRS | default "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16" =}";

## Default (8s) is tight once antivirus + greylisting + ARC + fuzzy checks
## are all enabled together (`rspamadm configtest` warns "task_timeout is
## less than maximum symbols cache timeout" otherwise -- verified against
## the built image: reported max symbols cache timeout is 21s, so 15s still
## triggered the warning and could kill ARC_CHECK/GREYLIST_SAVE/HISTORY_SAVE
## mid-scan). 25s clears that with headroom; scripts/validate-configs.sh
## fails the build if this regresses.
task_timeout = 25s;

