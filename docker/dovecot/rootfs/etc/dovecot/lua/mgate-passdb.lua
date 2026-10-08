-- MGate Dovecot passdb: delegates password verification to the mgate API.
--   POST {mgate_api_url}  (default http://api:8081/internal/v1/dovecot/passdb)
--   Authorization: Bearer {MGATE_INTERNAL_TOKEN}
-- The API is the single place for argon2id / SHA512-CRYPT verification, app passwords (2FA
-- users), webmail session tokens, brute-force bans and the login journal (login_events).
-- Wire contract: docs/mail/dovecot.md, section "passdb".
--
-- Runs in auth-worker processes (passdb lua { use_worker = yes }), so the blocking HTTP call
-- does not stall the auth master. Settings come from lua_settings (rendered at container
-- start into /etc/dovecot/mgate/runtime.conf.ext).

local json = require "json"

local api_url = nil
local api_token = nil
local http_client = nil

local RESULT_BY_NAME = {
  ok = dovecot.auth.PASSDB_RESULT_OK,
  password_mismatch = dovecot.auth.PASSDB_RESULT_PASSWORD_MISMATCH,
  user_unknown = dovecot.auth.PASSDB_RESULT_USER_UNKNOWN,
  user_disabled = dovecot.auth.PASSDB_RESULT_USER_DISABLED,
  pass_expired = dovecot.auth.PASSDB_RESULT_PASS_EXPIRED,
  internal_failure = dovecot.auth.PASSDB_RESULT_INTERNAL_FAILURE,
}

function script_init(args)
  api_url = args["mgate_api_url"] or "http://api:8081/internal/v1/dovecot/passdb"
  api_token = args["mgate_internal_token"]
  if api_token == nil or api_token == "" then
    error("mgate-passdb: lua_settings.mgate_internal_token is not set")
  end
  -- Setting names/values follow the Dovecot 2.4 http_client_* settings (times need units).
  http_client = dovecot.http.client {
    connect_timeout = "2s";
    request_timeout = "5s";
    request_max_attempts = 2;
    user_agent = "dovecot-mgate-passdb";
  }
  return 0
end

function script_deinit()
end

-- Auth cache key (auth_cache_* settings). It holds everything the API's verdict depends on:
--  * user and protocol (smtp-webmail is a protocol of its own, see docs/mail/postfix.md);
--  * the listener port the connection really arrived on, because the API accepts some
--    credentials only on a given listener (e.g. the internal IMAP listener 1143) - without it a
--    result cached for one listener would be reused for another;
--  * a hash of the credential, so a cached credential (a user's password, an app password, a
--    webmail session's credential) never shadows a different valid one for the same user.
-- The key starts with the username, so `doveadm auth cache flush <user>` removes all of a user's
-- entries. When a password changes or is reset, an app password is revoked, or a mailbox is
-- disabled or deleted, mgate flushes that user's entries (mgate-agent `POST /v1/auth-cache/flush`
-- runs the command; the doveadm HTTP API cannot), then ends the user's open sessions (doveadm
-- kick) and kicks again once auth_cache_ttl has passed in case the flush failed. A disabled or
-- deleted domain flushes the whole cache. Independently, a disabled mailbox cannot log in over
-- IMAP/POP3/ManageSieve even while its credentials are cached, because the userdb is never
-- cached (10-auth.conf).
function auth_passdb_get_cache_key()
  return "%{user}\t%{protocol}\t%{real_local_port}\t%{password | sha256 | hex}"
end

local function str(v)
  if v == nil then return "" end
  return tostring(v)
end

-- Ports expand to "0" when the request carries none (SASL from Postfix, doveadm): send "".
local function port(v)
  if v == nil or v == "" or v == "0" then return "" end
  return tostring(v)
end

function auth_password_verify(req, password)
  -- Request metadata via Dovecot 2.4 variable names (stable across auth_request member renames).
  local payload = json.encode({
    user = str(req.user),
    password = password,
    protocol = req:var_expand("%{protocol}"),
    mechanism = req:var_expand("%{mechanism}"),
    remote_ip = req:var_expand("%{remote_ip}"),
    local_ip = req:var_expand("%{local_ip}"),
    secured = req:var_expand("%{secured}"),
    session = req:var_expand("%{session}"),
    client_id = req:var_expand("%{client_id}"),
    -- Listener port the TCP connection really arrived on (1143 = internal IMAP listener for the
    -- webmail gateway, 143/993/... = public). The real_* values are never taken from a client's
    -- IMAP ID, unlike %{local_port}/%{local_ip}, which a client in login_trusted_networks may
    -- override (x-connected-port/-ip). Empty when unknown (SASL from Postfix, doveadm); the API
    -- treats that as a public listener.
    local_port = port(req:var_expand("%{real_local_port}")),
    -- Address of the TCP peer itself (e.g. the webmail gateway), whereas remote_ip is the client
    -- address forwarded by a trusted proxy (IMAP ID x-originating-ip).
    real_rip = req:var_expand("%{real_remote_ip}"),
  })

  local http_req = http_client:request {
    url = api_url;
    method = "POST";
  }
  http_req:add_header("Content-Type", "application/json")
  http_req:add_header("Authorization", "Bearer " .. api_token)
  http_req:set_payload(payload)

  local resp = http_req:submit()
  local status = tonumber(resp:status()) or 0
  if status ~= 200 then
    req:log_warning("mgate passdb API returned status " .. str(resp:status()) .. " " .. str(resp:reason()))
    return dovecot.auth.PASSDB_RESULT_INTERNAL_FAILURE, "mgate passdb API unavailable"
  end

  local ok, body = pcall(json.decode, resp:payload())
  if not ok or type(body) ~= "table" then
    req:log_error("mgate passdb API returned an invalid JSON body")
    return dovecot.auth.PASSDB_RESULT_INTERNAL_FAILURE, "mgate passdb API invalid response"
  end

  local result = RESULT_BY_NAME[str(body.result)]
  if result == nil then
    req:log_error("mgate passdb API returned unknown result '" .. str(body.result) .. "'")
    return dovecot.auth.PASSDB_RESULT_INTERNAL_FAILURE, "mgate passdb API invalid response"
  end

  if result ~= dovecot.auth.PASSDB_RESULT_OK then
    -- Dovecot 2.4: on failure the second return value must be nil or a string. A table is an
    -- "invalid error return value" and turns every refusal into a temporary failure (IMAP
    -- [UNAVAILABLE], no auth_failure_delay, fail_type=internal for the auth policy).
    if body.reason ~= nil and body.reason ~= "" then
      req:log_info("mgate passdb: " .. str(body.reason))
    end
    return result, nil
  end

  local fields = {}
  -- Canonical login name (case/alias normalisation done by the API).
  if body.user ~= nil and body.user ~= "" then
    fields.user = str(body.user)
  end
  -- TODO(S2): pass extra fields from the API (e.g. nologin/reason for suspended accounts,
  -- allow_nets) once the backend API defines them.
  return result, fields
end
