# Security Policy

> Основной документ по модели угроз почтовой платформы (на русском языке) —
> [`docs/SECURITY.md`](docs/SECURITY.md). Этот файл — короткая
> англоязычная политика раскрытия уязвимостей в формате, принятом для
> проектов на GitHub (права на использование проекта определяют
> [`LICENSE`](LICENSE) и [`EULA.md`](EULA.md)).

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub private vulnerability reporting:
**<https://github.com/mgate-server/mgate/security/advisories/new>**
(the "Report a vulnerability" button under the repository's *Security* tab).
The report is visible only to the maintainers until a fix is released.

Include, if possible:
- affected component (e.g. the backend API, `docker/postfix`, `web/apps/spa`) and
  version (`MGATE_VERSION` or the `VERSION` file);
- a minimal reproduction or proof of concept;
- your assessment of impact (what an attacker gains: RCE, auth bypass, data
  exposure, DoS, license/entitlement bypass, etc.);
- whether you intend to publish details, and any disclosure timeline you'd
  like us to work against.

## Supported versions

MGate uses calendar versioning (`YYYY.M.N`, e.g. `2026.10.1`; see
[`CHANGELOG.md`](CHANGELOG.md)). Security fixes are released for:

| Version | Supported |
|---|---|
| The latest release (`latest`) | yes |
| The previous month's line (`YYYY.M`, newest build of that month) | best effort, critical fixes only *(provisional; may be revised)* |
| Anything older | no — please upgrade |

Fixes ship as a new build number (`YYYY.M.N+1`) and are published as a GitHub
Release and a security advisory. To receive them, upgrade as described in the
"Versions and upgrades" section of [`README.md`](README.md) and pin the image
version in production.

## Response process (target)

1. Acknowledge receipt within 3 business days.
2. Confirm the issue, assess severity (CVSS-like triage), and identify
   affected versions.
3. Develop and test a fix privately; coordinate a disclosure date with the
   reporter.
4. Publish a fixed release and a security advisory (GitHub Security
   Advisories) crediting the reporter (unless they prefer anonymity).

## Known limitations of the current release

These are not vulnerabilities to report; they are features that are **not implemented yet**:

- **Two-factor authentication (TOTP) is in development.** Sign-in uses the password only; no
  one-time code is requested or verified, so 2FA enrolment is disabled in the interface.
- **Automatic certificate issuance (ACME / Let's Encrypt) is in development.** By default a
  self-signed certificate is served; upload your own certificate (PEM chain and private key)
  in the admin UI.

## Scope

This policy covers the MGate platform as distributed from this repository: the
deploy kit (compose, Helm chart, install scripts), mail-stack configuration
(Postfix, Dovecot, Rspamd, Unbound, Traefik, backup, firewall images), the `web/`
SPA source, **and the closed backend image** (`ghcr.io/mgate-server/mgate`,
`ghcr.io/mgate-server/mgate-agent`). The backend's source code is not published;
a vulnerability in its behavior (an auth bypass, a licence/entitlement bypass, an
API bug) is still very much in scope — report it through the same channel and we
will route it internally.

Out of scope: vulnerabilities in third-party components (Postfix, Dovecot,
Rspamd, ClamAV, Traefik, PostgreSQL, Valkey, Unbound) that are not introduced
or worsened by MGate's configuration of them — please report those upstream.
If you are unsure whether an issue is in MGate's configuration or upstream,
report it here anyway and we will triage and forward as needed.
