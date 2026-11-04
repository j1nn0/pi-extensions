# Contributor and agent guidance

## Implementation

- Keep `src/name.ts` and `src/schema.ts` pure: no filesystem, environment, or Pi imports belong there.
- Keep all filesystem access in `src/store.ts`. Every public store function returns a
  `StoreResult` (`{ ok, value }` / `{ ok, error }`) and does not throw for expected failures.
- Resolve the store through Pi's public `getAgentDir()` plus `shortcuts/`; keep the `agentDir`
  option so tests can use temporary directories.
- Preserve the write protocol: unique same-directory temp file, `O_EXCL` create, fsync, `link()`
  for new files, `rename()` only for explicit overwrites, temp cleanup on failure.
- Do not add a check-then-rename fallback for new saves. Where `link()` is unavailable or refused
  (`EPERM`, `ENOSYS`, `ENOTSUP`, `EOPNOTSUPP`, `EXDEV`), the save must fail with `io-error`; explicit
  overwrites keep using `rename()`.
- Never introduce last-write-wins. An existing shortcut is replaced only when the caller passes
  `overwrite: true`; keep the `already-exists` result stable for concurrent creators.
- Keep the 64 KiB file cap, the symlink/escape refusal, and the "list skips bad files without
  deleting or moving them" behavior. Do not add automatic repair or migration of stored files.
- `src/index.ts` re-exports the storage API. Its default factory must stay inert until the
  `/shortcut`, LLM, history, and rerun work lands: register no commands or tools for now. The
  default export exists only because Pi's loader rejects an entrypoint without one.

## Verification

- Add focused tests under `test/` for changed behavior. Store tests use real temporary directories,
  never mocks of `node:fs`.
- Run `pnpm --filter @j1nn0/pi-shortcuts check`, `pnpm --filter @j1nn0/pi-shortcuts test`, and
  `pnpm --filter @j1nn0/pi-shortcuts pack:check`, followed by the root `pnpm check` and
  `pnpm test` when practical.
- Keep `README.md` and `README.ja.md` aligned with behavior, and keep the implemented/planned split
  in both files honest.

## Release

- No release workflow exists for this package yet; adding one is a separate change. Until then, do
  not tag or publish from this package.
- When a workflow does exist, add a package-owned changelog entry and commit the release on `main`
  before tagging `pi-shortcuts-v<version>`, and publish only through that workflow using npm
  Trusted Publishing (never manually, never with an npm token).
