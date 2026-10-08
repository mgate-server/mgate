> This repository is a release mirror of the maintainers' main tree. Accepted pull
> requests are reviewed and merged into the main tree by the maintainers and land
> in this repository with the next release, so the PR itself may be closed
> instead of merged here.

## What / Why

<!-- What does this change do, and why? Link the issue it closes if any. -->

Closes #

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `perf` — performance improvement
- [ ] `test` — adding/fixing tests
- [ ] `build` / `ci` — build system or CI configuration
- [ ] `chore` — other (dependency bump, cleanup, ...)

## Checklist

- [ ] I read `CONTRIBUTING.md` (commit style, code style, docs rules).
- [ ] SPA changes: `make typecheck-web lint-web test-web build-web` pass —
      or I ran the subset relevant to my change and explain why the rest
      doesn't apply. (This repository has no backend source — the backend
      is distributed only as a container image.)
- [ ] Config/Docker changes: `make validate-configs` and/or
      `make compose-config` pass.
- [ ] Any incomplete work is marked `TODO(S<N>)` with a concrete
      description of what remains (not a bare `TODO`).
- [ ] Russian docs under `docs/` (and `README.md`) are updated if this PR
      changes user-visible or operational behavior.
- [ ] `CHANGELOG.md` `[Unreleased]` section updated if this is
      user-visible.
- [ ] No secrets, real credentials, or generated `.env` values are
      included in the diff.

## How was this tested?

<!-- Commands you ran, environments, screenshots/logs if relevant. -->

## Compatibility impact

<!-- Does this change a documented name, path, port, env var, image name or API
     (docs/CONFIGURATION.md, docs/ARCHITECTURE.md)? If yes, describe the change
     and how existing installations are affected. Otherwise write "None". -->
