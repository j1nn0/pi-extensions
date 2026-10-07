# Contributor and agent guidance

## Implementation

- `src/index.ts` owns Pi event handlers and background refreshes; keep `src/render.ts` free of I/O and use Pi TUI width helpers for rendered text.
- Scope quota data to the active provider. Discard responses from a provider that is no longer active, and preserve cached values on transient failures.
- Keep credentials out of rendered text and logs.

## Verification

- Add focused tests under `test/` for changed behavior, then run `pnpm check` and `pnpm test`. Run `pnpm pack:check` for packaging changes.

## Release

- Releases run from `.github/workflows/release.yml` on a pushed `v<version>` tag via npm Trusted Publishing; never publish manually or add npm tokens. See `docs/releasing.md`.
