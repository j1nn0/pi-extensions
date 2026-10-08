# pi-extensions

A pnpm monorepo for three independently installable Pi extensions. Each package is published separately; the private monorepo root is not itself a Pi extension.

| Package | npm package | Summary |
| --- | --- | --- |
| [`packages/pi-input-lock`](packages/pi-input-lock/README.md) | `@j1nn0/pi-input-lock` | Protects interactive Pi input while an agent is running, with configurable lock behavior. |
| [`packages/pi-footer`](packages/pi-footer/README.md) | `@j1nn0/pi-footer` | Replaces Pi's default footer with a compact status display for model, context, usage, session, Git, and more. |
| [`packages/pi-exit`](packages/pi-exit/README.md) | `@j1nn0/pi-exit` | Guarded `/exit` command that confirms before interrupting a running agent. |

## Development

Use Node.js `>=22.19.0` and pnpm 11.28.3. From the repository root, install the workspace dependencies:

```sh
pnpm install --frozen-lockfile
```

The root commands run across all three packages:

```sh
pnpm check
pnpm test
pnpm pack:check
```

To target one package, use its workspace filter:

```sh
pnpm --filter @j1nn0/pi-input-lock check
pnpm --filter @j1nn0/pi-input-lock test
pnpm --filter @j1nn0/pi-input-lock pack:check
pnpm --filter @j1nn0/pi-input-lock smoke:pty

pnpm --filter @j1nn0/pi-footer check
pnpm --filter @j1nn0/pi-footer test
pnpm --filter @j1nn0/pi-footer pack:check

pnpm --filter @j1nn0/pi-exit check
pnpm --filter @j1nn0/pi-exit test
pnpm --filter @j1nn0/pi-exit pack:check
```

The PTY smoke check is specific to pi-input-lock and requires the `script` command.

## Releases

Packages have separate release workflows and tag namespaces:

- `pi-input-lock-v<version>` releases `@j1nn0/pi-input-lock` through [`.github/workflows/release-pi-input-lock.yml`](.github/workflows/release-pi-input-lock.yml).
- `pi-footer-v<version>` releases `@j1nn0/pi-footer` through [`.github/workflows/release-pi-footer.yml`](.github/workflows/release-pi-footer.yml).
- `pi-exit-v<version>` releases `@j1nn0/pi-exit` through [`.github/workflows/release-pi-exit.yml`](.github/workflows/release-pi-exit.yml).

All three workflows publish through npm Trusted Publishing (GitHub Actions OIDC). See the [release guide](docs/release.md) for publisher setup and release steps.

## License

This monorepo is licensed under the MIT License. See the repository [MIT License](LICENSE).

Individual packages retain their respective copyright and attribution notices:
- [`@j1nn0/pi-input-lock`](packages/pi-input-lock/LICENSE)
- [`@j1nn0/pi-footer`](packages/pi-footer/LICENSE)
- [`@j1nn0/pi-exit`](packages/pi-exit/LICENSE)
