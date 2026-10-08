# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-08

### Added

- Add a guarded `/exit` command that asks for confirmation while an agent is running.
- Add `--force` to exit without confirmation, `--wait` to exit after the agent finishes, and `--help` for command help.
- Exit anyway when dialog UI is unavailable or confirmation fails, so a missing prompt never traps the session.

## [0.1.0-rc.0]

- Initial prerelease of the guarded `/exit` command with confirmation, `--force`, `--wait`, and `--help`.
