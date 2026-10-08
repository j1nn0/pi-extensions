# Contributor and agent guidance

## Implementation

- Keep `src/args.ts` pure and free of imports.
- Keep `src/exit.ts` testable through the structural `ExitContext`; adapt Pi's command context only in `createExitContext`.
- Preserve the fail-open direction: if waiting or confirmation fails, exit anyway.
- Register `/exit` only; Pi already provides `/quit`.

## Verification

- Add focused tests under `test/` for changed behavior.
- Run `pnpm --filter @j1nn0/pi-exit check`, `pnpm --filter @j1nn0/pi-exit test`, and `pnpm --filter @j1nn0/pi-exit pack:check` for package changes, followed by root checks when practical.

## Release

- Add a package-owned changelog entry and commit the release on `main` before tagging `pi-exit-v<version>`.
- Publish only through the matching GitHub Actions workflow using npm Trusted Publishing; never publish manually or add npm tokens.
