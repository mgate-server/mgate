## MGate: normal scanner worker. Not on the hot path while the proxy worker
## runs in self-scan mode (see worker-proxy.inc), but kept enabled and
## reachable on the standard port so:
##  - `rspamc`/`rspamadm` diagnostics and the mgate-agent can talk to it
##    directly (e.g. for ad-hoc `rspamc symbols` during support/debugging);
##  - switching to dedicated "proxy mode" later (TODO(S8)) only requires
##    editing worker-proxy.inc's `upstream` block, not this file.
bind_socket = "*:11333";

## Same hardening as worker-controller.inc -- see there for why.
allow_file_and_shm_inputs = false;
