{{/*
Copyright MGate contributors. See LICENSE and EULA.md.
*/}}

{{/* Base chart name, honoring nameOverride. */}}
{{- define "mgate.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name (release + chart), honoring fullnameOverride. */}}
{{- define "mgate.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "mgate.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Selector labels: the STABLE subset (name/instance[/component/network-tier]) used everywhere a
selector needs to keep matching across upgrades — spec.selector.matchLabels, podSelector,
NetworkPolicy peers. Never add chart-version-ish labels here (that would break selectors on every
chart bump). Usage: {{ include "mgate.selectorLabels" (dict "root" $ "component" "api") }}
(component "" or omitted -> name/instance only, for resources with no single owning component).
`component` is one of: api, webmail, worker, postfix, dovecot, rspamd, clamav, unbound, postgres,
valkey, migrate, backup — matches the compose service names so NetworkPolicy selectors and
`docker-compose` service names line up for operators reading both.
*/}}
{{- define "mgate.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mgate.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- if .component }}
app.kubernetes.io/component: {{ .component }}
mgate.io/network: {{ include "mgate.networkTier" .component }}
{{- end }}
{{- end -}}

{{/*
Full metadata.labels set for every object: selector labels (above) plus chart/version/managed-by.
The ONE helper templates call for `metadata.labels` (never combine it with "mgate.selectorLabels"
again separately — that duplicates the name/instance/component keys).
Usage: {{ include "mgate.labels" (dict "root" $ "component" "api") | nindent 4 }}
*/}}
{{- define "mgate.labels" -}}
{{ include "mgate.selectorLabels" . }}
helm.sh/chart: {{ include "mgate.chart" .root }}
{{- if .root.Chart.AppVersion }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{/*
Which compose "network" (public = egress/internet allowed, backend = internal-only) a component
belongs to, per the compose topology. Consumed by NetworkPolicy defaults.
*/}}
{{- define "mgate.networkTier" -}}
{{- $backendOnly := list "postgres" "valkey" -}}
{{- if has . $backendOnly -}}
backend
{{- else -}}
public
{{- end -}}
{{- end -}}

{{- define "mgate.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "mgate.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Name of the Secret holding generated/managed credentials. */}}
{{- define "mgate.secretsName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "mgate.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "mgate.configMapName" -}}
{{- printf "%s-config" (include "mgate.fullname" .) -}}
{{- end -}}

{{/*
First-party MGate image reference: <global.imageRegistry>/<repository>:<tag|global.imageTag|AppVersion>.
Usage: {{ include "mgate.image" (dict "root" $ "repository" .Values.api.image.repository "tag" .Values.api.image.tag) }}
*/}}
{{- define "mgate.image" -}}
{{- $root := .root -}}
{{- $registry := $root.Values.global.imageRegistry -}}
{{- $tag := .tag | default $root.Values.global.imageTag | default $root.Chart.AppVersion -}}
{{- printf "%s/%s:%s" $registry .repository $tag -}}
{{- end -}}

{{/*
Third-party image reference used as-is (no registry prefix): postgres, valkey/valkey,
clamav/clamav. Usage: {{ include "mgate.thirdPartyImage" .Values.postgresql.image }}
*/}}
{{- define "mgate.thirdPartyImage" -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end -}}

{{/*
PLAINTEXT value for one generated-secret key, preserved across `helm upgrade` by looking up the
live Secret first (lookup-preserve pattern) so credentials are not rotated on every upgrade. Falls
back to a user-supplied plaintext override (.Values.secrets.*), then to a fresh random value.
Returns plaintext on purpose: templates/secret.yaml renders it under `stringData:` (kubectl/the
API server base64-encodes it), and it also needs to be embeddable as-is inside composed DSNs like
MGATE_DATABASE_URL. `lookup` returns an empty dict when running offline (`helm template`), so a
new value is rendered every time in that mode — expected, see README.md "Известные ограничения".
Usage: {{ include "mgate.secretValue" (dict "root" $ "key" "MGATE_SECRET_KEY" "override" .Values.secrets.secretKey "length" 32) }}
*/}}
{{- define "mgate.secretValue" -}}
{{- $root := .root -}}
{{- $key := .key -}}
{{- $override := .override | default "" -}}
{{- $length := .length | default 32 | int -}}
{{- $secretName := include "mgate.secretsName" $root -}}
{{- $existing := (lookup "v1" "Secret" $root.Release.Namespace $secretName) -}}
{{- if and $existing $existing.data (hasKey $existing.data $key) -}}
{{- index $existing.data $key | b64dec -}}
{{- else if ne $override "" -}}
{{- $override -}}
{{- else -}}
{{- randAlphaNum $length -}}
{{- end -}}
{{- end -}}

{{/*
PLAINTEXT value of one key from an ARBITRARY existing Secret (used to read an
externally-provisioned Postgres/Valkey password so this chart can compose a full DSN for
MGATE_DATABASE_URL/MGATE_REDIS_URL). Returns "" when the Secret/key does not exist yet or when
rendering offline (`helm template`) — callers must tolerate an empty password in that case.
Usage: {{ include "mgate.lookupSecretKey" (dict "root" $ "name" .Values.externalDatabase.existingSecret "key" "password") }}
*/}}
{{- define "mgate.lookupSecretKey" -}}
{{- $root := .root -}}
{{- if .name -}}
{{- $existing := (lookup "v1" "Secret" $root.Release.Namespace .name) -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
PostgreSQL connection host. Bundled StatefulSet's Service is deliberately named bare "postgres"
(not release-prefixed) — see templates/api/service.yaml comment: postfix/dovecot pgsql lookup
configs and the mgate binary alike resolve peers by these exact compose
service names, so keeping them bare avoids needing extra *_HOST overrides baked into those images.
*/}}
{{- define "mgate.postgresHost" -}}
{{- if .Values.postgresql.enabled -}}
postgres
{{- else -}}
{{- .Values.externalDatabase.host -}}
{{- end -}}
{{- end -}}

{{- define "mgate.postgresPort" -}}
{{- if .Values.postgresql.enabled -}}
5432
{{- else -}}
{{- .Values.externalDatabase.port -}}
{{- end -}}
{{- end -}}

{{/* Valkey connection host — bare "valkey" Service name when bundled, see mgate.postgresHost. */}}
{{- define "mgate.valkeyHost" -}}
{{- if .Values.valkey.enabled -}}
valkey
{{- else -}}
{{- .Values.externalValkey.host -}}
{{- end -}}
{{- end -}}

{{- define "mgate.valkeyPort" -}}
{{- if .Values.valkey.enabled -}}
6379
{{- else -}}
{{- .Values.externalValkey.port -}}
{{- end -}}
{{- end -}}

{{/* Unbound resolver bare Service DNS name — replaces the compose static IP (172.30.1.53), see
README "Известные ограничения" / deviations in the final report. */}}
{{- define "mgate.unboundHost" -}}
unbound
{{- end -}}

{{/* Effective Postgres password (bundled -> generated/preserved; external -> read from its Secret). */}}
{{- define "mgate.postgresPassword" -}}
{{- if .Values.postgresql.enabled -}}
{{- include "mgate.secretValue" (dict "root" . "key" "POSTGRES_PASSWORD" "override" .Values.secrets.postgresPassword "length" 32) -}}
{{- else -}}
{{- include "mgate.lookupSecretKey" (dict "root" . "name" .Values.externalDatabase.existingSecret "key" .Values.externalDatabase.existingSecretPasswordKey) -}}
{{- end -}}
{{- end -}}

{{/* Effective Postgres owner username (mgate.databaseUrl's "user" segment): bundled -> postgresql.username,
external -> externalDatabase.username. Was hardcoded to postgresql.username unconditionally before
(bug: external DSN got the wrong user) — fixed here. */}}
{{- define "mgate.postgresUsername" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.username }}{{- else -}}{{ .Values.externalDatabase.username }}{{- end -}}
{{- end -}}

{{/* Effective Postgres database name: bundled -> postgresql.database, external -> externalDatabase.database.
Same bug as mgate.postgresUsername: mgate.databaseUrl and templates/configmap.yaml's POSTGRES_DB both
used to read .Values.postgresql.database even with postgresql.enabled=false. */}}
{{- define "mgate.postgresDatabase" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.database }}{{- else -}}{{ .Values.externalDatabase.database }}{{- end -}}
{{- end -}}

{{/* Effective mgate_mail read-only role username: bundled -> postgresql.mailUsername, external ->
externalDatabase.mailUsername. Postfix/Dovecot read this as POSTGRES_MAIL_USER (docker/postfix,
docker/dovecot init scripts) regardless of which Postgres backs the release. */}}
{{- define "mgate.postgresMailUsername" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.mailUsername }}{{- else -}}{{ .Values.externalDatabase.mailUsername }}{{- end -}}
{{- end -}}

{{/* Effective mgate_mail role password: bundled -> generated/preserved (docker/postgres/initdb creates the
role with it on first init, see templates/postgres/initdb-configmap.yaml); external -> read from the
externalDatabase.mailExistingSecret Secret (the operator's own Postgres cluster must already have the role;
this chart cannot run docker/postgres/initdb/* against a database it does not own). Postfix/Dovecot need this
directly as POSTGRES_MAIL_PASSWORD (their pgsql lookup config), not folded into a DSN like MGATE_DATABASE_URL. */}}
{{- define "mgate.postgresMailPassword" -}}
{{- if .Values.postgresql.enabled -}}
{{- include "mgate.secretValue" (dict "root" . "key" "POSTGRES_MAIL_PASSWORD" "override" .Values.secrets.postgresMailPassword "length" 32) -}}
{{- else -}}
{{- include "mgate.lookupSecretKey" (dict "root" . "name" .Values.externalDatabase.mailExistingSecret "key" .Values.externalDatabase.mailExistingSecretPasswordKey) -}}
{{- end -}}
{{- end -}}

{{/* Effective Valkey password (bundled -> generated/preserved; external -> read from its Secret). */}}
{{- define "mgate.valkeyPassword" -}}
{{- if .Values.valkey.enabled -}}
{{- include "mgate.secretValue" (dict "root" . "key" "VALKEY_PASSWORD" "override" .Values.secrets.valkeyPassword "length" 32) -}}
{{- else -}}
{{- include "mgate.lookupSecretKey" (dict "root" . "name" .Values.externalValkey.existingSecret "key" .Values.externalValkey.existingSecretPasswordKey) -}}
{{- end -}}
{{- end -}}

{{/* postgres://user:password@host:port/db — matches MGATE_DATABASE_URL exactly. An external
database additionally gets `?sslmode=<externalDatabase.sslmode>` (the backend's PostgreSQL client
honours the libpq-style parameter); the bundled one is cluster-internal and stays plain. */}}
{{- define "mgate.databaseUrl" -}}
{{- $user := include "mgate.postgresUsername" . -}}
{{- $pass := include "mgate.postgresPassword" . -}}
{{- $host := include "mgate.postgresHost" . -}}
{{- $port := include "mgate.postgresPort" . -}}
{{- $db := include "mgate.postgresDatabase" . -}}
{{- printf "postgres://%s:%s@%s:%s/%s" $user $pass $host $port $db -}}
{{- if and (not .Values.postgresql.enabled) .Values.externalDatabase.sslmode -}}
{{- printf "?sslmode=%s" .Values.externalDatabase.sslmode -}}
{{- end -}}
{{- end -}}

{{/* redis://:password@host:port/0 — matches MGATE_REDIS_URL exactly (db 0 = mgate). */}}
{{- define "mgate.redisUrl" -}}
{{- $pass := include "mgate.valkeyPassword" . -}}
{{- $host := include "mgate.valkeyHost" . -}}
{{- $port := include "mgate.valkeyPort" . -}}
{{- printf "redis://:%s@%s:%s/0" $pass $host $port -}}
{{- end -}}

{{/* Shared certs volume name (mode=mgate PVC). */}}
{{- define "mgate.certsPvcName" -}}
{{- printf "%s-certs" (include "mgate.fullname" .) -}}
{{- end -}}

{{/*
Certs volume definition (one item under a Pod's `volumes:` list), shaped by `.Values.certs.mode`:
  mgate        -> the shared RWX PVC, full /certs/live/*+/certs/default hierarchy (the backend's ACME client owns
                  writing it; see mgate.certsWriter below for which Pod gets RW).
  cert-manager -> projects the cert-manager-managed Secret's tls.crt/tls.key onto
                  /certs/default/{fullchain,privkey}.pem only (see README "Известные ограничения":
                  no /certs/live/<name> hierarchy in this mode — TODO(S8) multi-domain sync).
  existingSecret -> same projection, from a user-supplied Secret.
Usage: {{ include "mgate.certsVolume" . }}
*/}}
{{- define "mgate.certsVolume" -}}
{{- if eq .Values.certs.mode "mgate" }}
- name: certs
  persistentVolumeClaim:
    claimName: {{ include "mgate.certsPvcName" . }}
{{- else if eq .Values.certs.mode "cert-manager" }}
- name: certs
  secret:
    secretName: {{ include "mgate.fullname" . }}-tls
    items:
      - key: tls.crt
        path: default/fullchain.pem
      - key: tls.key
        path: default/privkey.pem
{{- else }}
- name: certs
  secret:
    secretName: {{ .Values.certs.existingSecret.name }}
    items:
      - key: tls.crt
        path: default/fullchain.pem
      - key: tls.key
        path: default/privkey.pem
{{- end }}
{{- end -}}

{{/*
Whether THIS component should mount the certs volume read-write. Only meaningful in mode=mgate
(secret-backed volumes are always effectively read-only); ACME issuance/renewal by the backend runs from
the worker's job scheduler ("ACME renewals"), so only `worker` writes.
Usage: {{ include "mgate.certsReadOnly" (dict "root" $ "component" "worker") }}
*/}}
{{- define "mgate.certsReadOnly" -}}
{{- if and (eq .root.Values.certs.mode "mgate") (eq .component "worker") -}}
false
{{- else -}}
true
{{- end -}}
{{- end -}}

{{/*
One NetworkPolicyPeer selecting all pods of one component in this release (same namespace).
Usage: {{ include "mgate.npPeer" (dict "root" $ "component" "postfix") }}
*/}}
{{- define "mgate.npPeer" -}}
- podSelector:
    matchLabels:
      app.kubernetes.io/instance: {{ .root.Release.Name }}
      app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Default container securityContext, merged with a component-specific override dict (e.g. postfix
needs CAP_NET_BIND_SERVICE-equivalent handling done image-side via setcap, not here, since ports
<1024 still require a capability or an unprivileged-port sysctl — see docker/postfix; mirror the chosen approach here if it changes).
Usage: {{ include "mgate.securityContext" (dict "root" $ "override" (dict "runAsUser" 5000)) }}
*/}}
{{- define "mgate.securityContext" -}}
{{- $base := deepCopy .root.Values.containerSecurityContext -}}
{{- $override := .override | default dict -}}
{{/* NOT `merge $override $base`: Sprig's `merge` (mergo) treats a Go zero value — `false` for a
bool — as "empty" and fills it back in from $base, so `override (dict "allowPrivilegeEscalation"
false)` would silently lose to $base's own `false`/`true` instead of taking effect. `deepCopy` first
because Sprig `set` mutates its dict argument in place, and $base is a live reference into
.Values — mutating it directly would leak this component's override into every other component
rendered afterwards in the same `helm template`/install run. */}}
{{- range $k, $v := $override -}}
{{- $base = set $base $k $v -}}
{{- end -}}
{{- toYaml $base -}}
{{- end -}}

{{/*
Default POD securityContext, merged with a component-specific override — the Pod-level equivalent of
"mgate.securityContext" above. Needed because .Values.global.podSecurityContext sets
`runAsNonRoot: true`, which is correct for the mgate image (api/webmail/worker/migrate: baked-in
USER 10001:10001) and for rspamd/unbound (upstream images already drop root, see their Dockerfiles),
but WRONG for postfix/dovecot/clamav: all three images start their entrypoint as root by design
(s6-overlay for postfix/dovecot needs root to chroot/setuid/setgid its children; the upstream ClamAV
entrypoint chowns /var/lib/clamav then setuid/setgid's to the clamav user) — `runAsNonRoot: true`
there makes the kubelet refuse to start the container at all (CreateContainerConfigError), which is
the "wrong runAsNonRoot assumption" callout in this chart's task. Those three components must call
this helper with `(dict "runAsNonRoot" false)`.
Usage: {{ include "mgate.podSecurityContext" (dict "root" $ "override" (dict "runAsNonRoot" false)) }}
*/}}
{{- define "mgate.podSecurityContext" -}}
{{- $base := deepCopy .root.Values.global.podSecurityContext -}}
{{- $override := .override | default dict -}}
{{/* Deliberately NOT Sprig `merge` — see the identical, longer comment in "mgate.securityContext"
above: mergo treats `false` as a zero/empty value and silently restores $base's `true`, which is
exactly the one override this helper exists to make work (`runAsNonRoot: false` for postfix/dovecot/
clamav). `deepCopy` for the same reason too: $base is a live reference into .Values.global, and
Sprig `set` mutates in place. */}}
{{- range $k, $v := $override -}}
{{- $base = set $base $k $v -}}
{{- end -}}
{{- toYaml $base -}}
{{- end -}}

{{/*
Best-effort DNS wiring so DNSBL/RBL/DANE/DNSSEC lookups made by the mail daemons themselves (via the
container's system resolver — glibc for Postfix, Rspamd's own async resolver falls back to parsing
/etc/resolv.conf when no `dns.nameserver` is configured, see docker/rspamd/local.d/options.inc) reach
the DNSSEC-validating `unbound` component instead of whatever the node's/cluster's default upstream
is. Compose pins `unbound` to a static IP and lists it as literally the ONLY nameserver
(`dns: [...]`, plus `dns_opt: [trust-ad]` so the DNSSEC AD bit survives); Kubernetes has no portable
per-Pod static-IP equivalent, and `dnsConfig.nameservers` is validated as a literal IP address, not a
Service DNS name — so we cannot just point every mail Pod at "unbound" by name the way compose does.

What this DOES do: resolve the unbound Service's *current* ClusterIP via `lookup` at render time
(works against a live cluster on `helm install`/`upgrade` once the Service exists; returns nothing on
the very first install before this same release has created it, and always nothing under
`helm template`/offline rendering) and, when found, merge it into the Pod's resolv.conf as an EXTRA
nameserver alongside cluster DNS (dnsPolicy stays "ClusterFirst" — NOT "None" — specifically so
Service names this Pod still needs, like "postgres"/"dovecot"/"valkey", keep resolving via
CoreDNS/kube-dns; unbound only does public recursive resolution, it has no idea about cluster
internal names). The `trust-ad` option is always added, matching compose's `dns_opt`.

What this does NOT fully do: glibc's resolver tries nameservers in listed order and stops at the
first definitive answer, so as long as CoreDNS is nameserver #1 (which it must stay, for the reason
above) an external DNSBL/DANE query is normally answered — non-authoritatively — by CoreDNS's own
configured upstream before unbound is ever asked, same as any other Kubernetes Pod; unbound only gets
consulted when CoreDNS's own upstream path fails outright. Getting every such lookup to actually go
through unbound needs a CoreDNS stub-domain/forward configured cluster-side (out of this chart's
reach) — this is the same gap already called out in README.md "Известные ограничения" and worth
re-reading before assuming this is a full fix.
Usage: {{ include "mgate.dnsConfig" . | nindent 6 }} directly under a Pod template's `spec:`.
*/}}
{{- define "mgate.dnsConfig" -}}
{{- $ip := "" -}}
{{- $svc := lookup "v1" "Service" .Release.Namespace "unbound" -}}
{{- if and $svc $svc.spec $svc.spec.clusterIP (ne $svc.spec.clusterIP "None") -}}
{{- $ip = $svc.spec.clusterIP -}}
{{- end -}}
dnsPolicy: ClusterFirst
dnsConfig:
{{- if $ip }}
  nameservers: [{{ $ip }}]
{{- end }}
  options:
    - name: trust-ad
{{- end -}}

{{/*
initContainer that brings the database schema up to date before an api/webmail/worker container
starts — the Kubernetes equivalent of compose's `depends_on: migrate: service_completed_successfully`.
Runs plain `mgate migrate` (no `--bootstrap`): idempotent, retries the database connection for about
a minute (the kubelet restarts it with back-off after that, e.g. while the bundled PostgreSQL is
still provisioning its volume), and serialized with every other migrator — the other components'
initContainers and the migrate hook Job — by the migrator's PostgreSQL advisory lock. On
`helm upgrade` the pre-upgrade hook Job has already migrated, so this is a no-op check.
Usage (under a Pod template's `spec:`): {{- include "mgate.migrateInitContainer" . | nindent 6 }}
*/}}
{{- define "mgate.migrateInitContainer" -}}
initContainers:
  - name: migrate
    image: {{ include "mgate.image" (dict "root" . "repository" .Values.image.backend.repository "tag" .Values.image.backend.tag) }}
    imagePullPolicy: {{ .Values.global.imagePullPolicy }}
    args: ["migrate"]
    envFrom:
      - configMapRef:
          name: {{ include "mgate.configMapName" . }}
      - secretRef:
          name: {{ include "mgate.secretsName" . }}
    securityContext:
      {{- include "mgate.securityContext" (dict "root" .) | nindent 6 }}
    resources:
      {{- toYaml .Values.migrate.resources | nindent 6 }}
{{- end -}}
