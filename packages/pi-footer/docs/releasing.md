# Releasing

Releases are published by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a `v<version>` tag is pushed:

```text
tag push → check → npm publish (Trusted Publishing) → npm registry verification → GitHub Release
```

npm authenticates the workflow through GitHub Actions OIDC. No npm token is stored in the repository or its secrets, and provenance is generated automatically.

## One-time npm setup

Configure this on npmjs.com before pushing the first release tag; otherwise `npm publish` fails with `ENEEDAUTH`. npm does not validate the values when they are saved, and every field is case-sensitive.

Package `@j1nn0/pi-footer` → **Settings** → **Trusted Publisher** → **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `j1nn0` |
| Repository | `pi-footer` |
| Workflow filename | `release.yml` (the filename only, not `.github/workflows/release.yml`) |
| Environment name | leave empty |
| Allowed actions | enable `npm publish` |

Optionally, after the first automated release succeeds, set **Settings** → **Publishing access** to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working.

## Releasing a version

1. On `main`, set `package.json` `version` and move the `[Unreleased]` entries in `CHANGELOG.md` to a `## [<version>] - <YYYY-MM-DD>` section. Commit and push `main`.
2. Tag that commit and push the tag:

   ```bash
   git tag v<version>
   git push origin v<version>
   ```

The workflow fails before publishing when the tag is not `v<major>.<minor>.<patch>[-<prerelease>]`, the tag does not match `package.json` `name`/`version`/`repository.url`, the tagged commit is not on `main`, the changelog section is missing, any check fails, or the version is already on npm. Prerelease versions (`v1.2.3-beta.1`) are published under the `next` dist-tag and marked as GitHub prereleases; other versions go to `latest`.

## Recovering from a failed run

- **Failed before `Publish`**: nothing was published. Fix the cause; to release the same version, delete and re-push the tag.
- **`Publish` or `Verify npm registry` failed**: inspect `npm view @j1nn0/pi-footer` before doing anything. npm versions are immutable, and the workflow refuses to publish a version that already exists.
- **Only `Release (GitHub)` failed**: npm already serves the version. Re-run the failed job; it uses the tarball npm serves and creates the release for the existing tag.
