# @mgate/api-client

Typed `fetch` client for the mgate public API, generated from `openapi.json`.
`openapi.json` is **committed** — the SPA build never needs a live
backend or a local Rust toolchain to typecheck or build.

## Refreshing `openapi.json`

The backend is a closed binary distributed only as a container image, so its source is not part
of this repository — this workspace has no `cargo`, and this package's own `gen` script never
assumes one. Regenerating the spec is a two-step, repo-root flow:

1. `make openapi-sync` (public repo root Makefile) runs
   `docker run --rm $MGATE_IMAGE openapi > web/packages/api-client/openapi.json` — pulls/uses
   the already-built backend image and asks its `mgate openapi` subcommand to print the current
   spec. No local Rust source or `cargo` involved on either side.
2. `npm run gen -w @mgate/api-client` (this package's own script) regenerates
   `src/generated/schema.d.ts` from that `openapi.json` via `openapi-typescript`.

Commit both the refreshed `openapi.json` and the regenerated `schema.d.ts` together.
