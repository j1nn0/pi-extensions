# Changelog

## [Unreleased]

### Added

- Add shortcut name normalization and validation (NFKC, lowercase, whitespace/underscore collapse, path/traversal/dotfile/length rejection).
- Add `schemaVersion: 1` record validation for `name`, `description`, `procedure`, `params`, `createdAt`, `updatedAt`, and `source`.
- Add a user-global shortcut store under `<Pi agent dir>/shortcuts` with atomic temp-file commits, an explicit-overwrite guard, a 64 KiB size cap, corrupt/unknown-version rejection, and symlink refusal.
- Add `saveShortcut`, `loadShortcut`, `getShortcut`, `existsShortcut`, and `listShortcuts` with Vitest coverage.
- Add English and Japanese READMEs that separate the implemented storage foundation from the planned command, LLM, history, and rerun work.
