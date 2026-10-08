## MGate: rspamd_proxy worker in Milter mode, self-scan (single-node) setup.
## Postfix talks to Rspamd exclusively through this worker:
##   smtpd_milters = inet:rspamd:11332   (see docker/postfix)
## TODO(S8): switch to dedicated "proxy mode" (multiple normal-worker
## scanners behind this proxy, `upstream "scan" { hosts = "..."; }`) once
## throughput requires horizontal scaling; self-scan is sufficient for a
## single-node mgate install (see docs/mail/rspamd.md).
milter = true;
bind_socket = "*:11332";
timeout = 60s;

upstream "local" {
    self_scan = yes;
}

## Header carrying the spam verdict for MTAs that inspect it directly
## (Postfix header_checks can also key off Authentication-Results / the
## milter_headers module -- see local.d/milter_headers.conf).
spam_header = "X-Spam";

## Same hardening as worker-controller.inc/worker-normal.inc: this worker
## also binds on all interfaces (Postfix reaches it as `rspamd:11332` from
## the backend network) -- disable the File/Path/Shm scan-input source.
allow_file_and_shm_inputs = false;
