# Changelog

## [Unreleased]

- Convert the `pi-minimal-footer` package from the `ogulcancelik/pi-extensions` monorepo into the standalone `@j1nn0/pi-footer` package.
- Target Pi 1.0 (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` `>=1.0.0` as peer dependencies) and Node.js `>=22.19.0`.
- Split the single-file implementation into modules under `src/` without changing footer output or provider behavior.
- Add Vitest characterization and unit tests, TypeScript checking, and CI workflows.
