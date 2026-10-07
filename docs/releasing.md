# Releasing

The extensions are released independently from this monorepo. Each package has its own npm Trusted Publisher workflow and tag namespace:

| Package | npm name | Package directory | Workflow filename | Tag form |
| --- | --- | --- | --- | --- |
| pi-input-lock | `@j1nn0/pi-input-lock` | `packages/pi-input-lock` | `release-pi-input-lock.yml` | `pi-input-lock-v<version>` |
| pi-footer | `@j1nn0/pi-footer` | `packages/pi-footer` | `release-pi-footer.yml` | `pi-footer-v<version>` |

A release runs checks, uses `pnpm pack` to resolve workspace `catalog:` references in the packed manifest, then publishes that exact tarball to npm through GitHub Actions OIDC. The workflow verifies the registry package name, version, dist-tag, and integrity before creating the GitHub Release. The root monorepo is not an installable Pi extension; publish and install the individual npm packages.

## One-time npm Trusted Publisher setup

Configure each npm package on npmjs.com before its first tagged release. Under the package's **Settings → Trusted Publisher → GitHub Actions**, use:

| Field | Value |
| --- | --- |
| Organization or user | `j1nn0` |
| Repository | `pi-extensions` |
| Workflow filename | `release-pi-input-lock.yml` for pi-input-lock; `release-pi-footer.yml` for pi-footer |
| Environment name | leave empty |
| Allowed actions | enable `npm publish` |

The workflow filename is the filename only, not the `.github/workflows/` path. Configure the pi-input-lock publisher on `@j1nn0/pi-input-lock` and the pi-footer publisher on `@j1nn0/pi-footer`. No npm token is stored in the repository or its secrets; npm authenticates through OIDC and generates provenance. After the first successful release, npm's optional **Require two-factor authentication and disallow tokens** publishing setting can be enabled; Trusted Publishing continues to work.

## Releasing a package

1. On `main`, update the selected package's `package.json` version and move its `[Unreleased]` entries in `CHANGELOG.md` into a `## [<version>] - <YYYY-MM-DD>` section. Commit and push `main` before tagging.
2. Create and push the package-specific tag from that commit. For example:

   ```sh
   git tag pi-input-lock-v<version>
   git push origin pi-input-lock-v<version>
   ```

   Or, for pi-footer:

   ```sh
   git tag pi-footer-v<version>
   git push origin pi-footer-v<version>
   ```

   Replace `<version>` with the package's version, such as `0.2.1` or `0.2.1-beta.1`. Tags must use plain SemVer with an optional prerelease; build metadata is rejected because npm drops it.
3. The matching workflow checks the package name, tag/version equality, monorepo `repository.url`, main-branch ancestry, required changelog section, tests, and that the version is not already published. It also checks the Node.js/npm version floor for Trusted Publishing.

Stable versions publish to the `latest` npm dist-tag. Prereleases publish to `next` and are marked as GitHub prereleases. The registry check retries up to 30 times at 10-second intervals (about 5 minutes) and verifies the package name, version, dist-tag, and integrity. The GitHub Release is created only after that succeeds; it attaches the registry-served tarball only if its integrity matches the packed publish tarball.

## Recovering from a failed run

- **Failure before npm publish:** nothing was published. Fix the cause, then rerun the intended tag workflow.
- **Publish or registry verification failure:** inspect `npm view <package>@<version>` before taking action. npm versions are immutable; do not try to publish an existing version again.
- **Only GitHub Release creation failed:** npm already serves the package. Rerun the failed release job; it verifies and attaches the registry tarball for the existing tag.
