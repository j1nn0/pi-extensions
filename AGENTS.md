# Repository Guidance

## Workspace rules

- This is a private pnpm workspace. Install and run aggregate commands from the repository root; the publishable extensions live under `packages/` and remain independent packages.
- Use pnpm 11.28.3, Node.js 24 or newer for the full workspace, and preserve the root lockfile. Do not turn the repository root into an installable Pi extension.
- Target package scripts with `pnpm --filter @j1nn0/pi-input-lock ...` or `pnpm --filter @j1nn0/pi-footer ...`; avoid commands that accidentally operate on the wrong package.
- Keep user-facing documentation aligned with behavior. pi-input-lock has English and Japanese READMEs; update both when changing its user-facing behavior.
- Use Conventional Commit messages (`feat:`, `fix:`, `docs:`, `ci:`, `test:`, `chore:`; use `feat!:` for breaking changes).

## Package-specific guidance

- **pi-input-lock** is always loaded; `PI_INPUT_LOCK=1` selects its initial enabled state, while runtime commands are process-local. Preserve dual-channel input routing, editor/draft restoration, fail-open behavior, and first-existing-file config precedence (settings are not merged). See [`packages/pi-input-lock/AGENTS.md`](packages/pi-input-lock/AGENTS.md) for architecture, config, and test invariants.
- **pi-footer** keeps rendering free of I/O, scopes quota data to the active provider, discards stale-provider responses, and never exposes credentials in output or logs. See [`packages/pi-footer/AGENTS.md`](packages/pi-footer/AGENTS.md) for implementation and verification notes.

## Commands and tests

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm pack:check
```

Targeted commands:

```sh
pnpm --filter @j1nn0/pi-input-lock check
pnpm --filter @j1nn0/pi-input-lock test
pnpm --filter @j1nn0/pi-input-lock pack:check
pnpm --filter @j1nn0/pi-input-lock smoke:pty

pnpm --filter @j1nn0/pi-footer check
pnpm --filter @j1nn0/pi-footer test
pnpm --filter @j1nn0/pi-footer pack:check
```

Run focused tests for the affected package, then the root checks when practical. Run `smoke:pty` when changing pi-input-lock wiring, commands, or release metadata; it requires the platform `script` utility.

## Release rules

- Each package owns its version and `CHANGELOG.md` section. Add a `## [<version>]` entry and commit it on `main` before tagging.
- Use `pi-input-lock-v<version>` for pi-input-lock and `pi-footer-v<version>` for pi-footer. The matching root workflow validates package name, version, repository URL, changelog, and that the tagged commit is on `main`.
- Publish only through the matching GitHub Actions workflow and npm Trusted Publishing (OIDC); never add or use an npm token. Stable versions publish under `latest`; prereleases publish under `next` and create GitHub prereleases.
- See [`packages/pi-footer/docs/releasing.md`](packages/pi-footer/docs/releasing.md) for one-time publisher setup, tag commands, and recovery guidance.
