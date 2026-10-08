## MGate: log to stdout/stderr like every other container (captured by the
## Docker json-file driver, rotated by the compose logging defaults).
## Never write to a file inside the container -- there is no log volume
## for rspamd, and `docker logs` / the eventual log-shipping pipeline
## (the backend ingesting from Valkey `mgate:logs`, fed by mgate-agent) is
## the intended path, not this module's own history.
type = "console";
level = "{= env.LOG_LEVEL | default "notice" =}";
systemd = false;
