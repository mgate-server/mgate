## MGate: controller worker (WebUI + management HTTP API on :11334).
## Password is mandatory and injected via env-templating -- config load
## FAILS if RSPAMD_CONTROLLER_PASSWORD is not set, which is intentional
## (`rspamadm configtest` is expected to be run with it exported; see
## docs/mail/rspamd.md "Verification"). It maps 1:1 to the documented env var
## RSPAMD_CONTROLLER_PASSWORD (docs/CONFIGURATION.md), already carrying the
## RSPAMD_ prefix Rspamd's template engine requires -- no remapping needed.
##
## Same password is used for read-only and privileged (learn/map-edit)
## commands (Rspamd's documented behaviour when only `password` is set).
## TODO(S1): consider a separate weaker read-only password + PBKDF2-Blake2
## hashing via `rspamadm pw` once the admin UI proxies controller calls
## instead of using it directly.
password = "{= env.CONTROLLER_PASSWORD =}";
bind_socket = "*:11334";

## Loopback callers (our own HEALTHCHECK, mgate-agent running as a sidecar
## in the same container network namespace is NOT the case here -- this is
## strictly 127.0.0.1 inside the rspamd container itself) skip the password
## so the healthcheck stays a plain `rspamc stat` with no secret handling.
secure_ip = "127.0.0.0/8";

## Hardening: this worker binds on all interfaces (`*:11334`, reachable
## from the whole `backend` network, not just loopback) -- disable the
## File/Path/Shm scan-input source so a client on the backend network
## cannot ask Rspamd to read arbitrary files off disk. Caught by Rspamd's
## own startup warning during image verification; upstream default will
## flip to `false` in a future major release anyway.
allow_file_and_shm_inputs = false;
