#!/usr/bin/env sh
# MGate Unbound healthcheck: confirm the daemon actually answers queries
# end-to-end, not just "process is running". A root NS query forces
# Unbound through its full resolution path (root hints -> iterate -> reply)
# without depending on any specific external domain staying up.
set -eu

drill -p 53 @127.0.0.1 . NS > /dev/null 2>&1
