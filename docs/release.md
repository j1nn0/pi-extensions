# Release

The extensions are released independently from this monorepo. Each package has its own npm Trusted Publisher workflow and tag namespace:

| Package | npm name | Package directory | Workflow filename | Tag form |
| --- | --- | --- | --- | --- |
| pi-input-lock | `@j1nn0/pi-input-lock` | `packages/pi-input-lock` | `release-pi-input-lock.yml` | `pi-input-lock-v<version>` |
| pi-footer | `@j1nn0/pi-footer` | `packages/pi-footer` | `release-pi-footer.yml` | `pi-footer-v<version>` |
| pi-exit | `@j1nn0/pi-exit` | `packages/pi-exit` | `release-pi-exit.yml` | `pi-exit-v<version>` |

A release runs checks, uses `pnpm pack` to resolve workspace `catalog:` references in the packed manifest, then publishes that exact tarball to npm through GitHub Actions OIDC. The workflow verifies the registry package name, version, dist-tag, and integrity before creating the GitHub Release. The root monorepo is not an installable Pi extension; publish and install the individual npm packages.

## One-time npm Trusted Publisher setup

Trusted Publishing can only be configured for a package that already exists on the registry, and npm cannot publish a package's first version through OIDC. pi-input-lock and pi-footer are already published, so configure their publishers directly. A new package name needs the bootstrap below first.

### Existing packages

Under the package's **Settings → Trusted Publisher → GitHub Actions**, use:

| Field | Value |
| --- | --- |
| Organization or user | `j1nn0` |
| Repository | `pi-extensions` |
| Workflow filename | `release-pi-input-lock.yml` for pi-input-lock; `release-pi-footer.yml` for pi-footer; `release-pi-exit.yml` for pi-exit |
| Environment name | leave empty |
| Allowed actions | enable `npm publish` |

The workflow filename is the filename only, not the `.github/workflows/` path. Configure the pi-input-lock publisher on `@j1nn0/pi-input-lock`, the pi-footer publisher on `@j1nn0/pi-footer`, and the pi-exit publisher on `@j1nn0/pi-exit`. No npm token is stored in the repository or its secrets; npm authenticates through OIDC and generates provenance. After the first successful release, npm's optional **Require two-factor authentication and disallow tokens** publishing setting can be enabled; Trusted Publishing continues to work.

### Bootstrapping a new package

Trusted Publishing cannot be configured for a package that does not exist yet, and npm cannot publish a package's first version through OIDC. Staged publishing creates the package name without a token. Run this once, from an account that has publish access and 2FA enabled:

```sh
cd packages/<package>
npm stage publish --tag next
npm trust github @j1nn0/<package> \
  --file release-<package>.yml \
  --repo j1nn0/pi-extensions \
  --allow-publish
```

`--tag` is required when the staged version is a prerelease: npm rejects a prerelease without it. Use the dist-tag the workflow publishes to, which is `next` for a prerelease and `latest` for a stable version.

`npm stage publish` on a package that does not exist yet publishes a placeholder `0.0.0-stage` version and sets `latest` to it. Do not approve the staged version: the tag workflow publishes that same version through OIDC with provenance, and npm versions are immutable.

`--allow-publish` is required. Configurations created after 2026-09-03 allow staged publishing only, so without it the workflow's `npm publish` is rejected.

A trusted publisher configuration must complete its first successful publish within 2 days, or it expires and can no longer be edited. Push the release tag promptly after configuring it.

Staged publishing requires npm CLI 11.15.0 or later and Node.js 22.14.0 or later.

### Dist-tags while a package is bootstrapping

Creating a package through staged publishing puts `latest` on the `0.0.0-stage` placeholder. Publishing the first prerelease with `--tag next` can still leave `latest` pointing at that prerelease instead of at the placeholder; `@j1nn0/pi-exit` reached `latest = 0.1.0-rc.0` this way.

Leave `latest` alone. Do not repoint it at the placeholder, which would make a tagless install resolve to a version with no package content. The stable release workflow publishes with `--tag latest`, so the first stable release moves `latest` off the prerelease on its own.

`next` carries prereleases and `latest` is where stable releases land. A bootstrap can leave `latest` on a prerelease until the first stable release, and that state is expected rather than a fault to repair.

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

   Or, for pi-exit:

   ```sh
   git tag pi-exit-v<version>
   git push origin pi-exit-v<version>
   ```

   Replace `<version>` with the package's version, such as `0.2.1` or `0.2.1-beta.1`. Tags must use plain SemVer with an optional prerelease; build metadata is rejected because npm drops it.
3. The matching workflow checks the package name, tag/version equality, monorepo `repository.url`, main-branch ancestry, required changelog section, tests, and that the version is not already published. It also checks the Node.js/npm version floor for Trusted Publishing.

Stable versions publish to the `latest` npm dist-tag. Prereleases publish to `next` and are marked as GitHub prereleases. The registry check retries up to 30 times at 10-second intervals (about 5 minutes) and verifies the package name, version, dist-tag, and integrity. The GitHub Release is created only after that succeeds; it attaches the registry-served tarball only if its integrity matches the packed publish tarball.

## Recovering from a failed run

- **Failure before npm publish:** nothing was published. Fix the cause, then rerun the intended tag workflow.
- **Publish or registry verification failure:** inspect `npm view <package>@<version>` before taking action. npm versions are immutable; do not try to publish an existing version again.
- **Only GitHub Release creation failed:** npm already serves the package. Rerun the failed release job; it verifies and attaches the registry tarball for the existing tag.
