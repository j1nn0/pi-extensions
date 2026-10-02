# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-02

First standalone release of `@j1nn0/pi-footer`, a fork of Can Celik's `pi-minimal-footer` from the `ogulcancelik/pi-extensions` monorepo.

### Added

- Standalone package `@j1nn0/pi-footer` for Pi 1.x (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` `>=1.0.0` as peer dependencies) on Node.js `>=22.19.0`.
- Two-line Claude Code StatusLine-style footer:
  - `model · level · think ON` (or `think OFF`) from Pi's live `ctx.thinkingLevel`.
  - Context gauge from Pi's `ctx.getContextUsage()`: 10-cell bar, used percentage, `used/window` token counts, `!` / `⚠` / `COMPACT` warnings from 70% / 85% / 95%, and `?%` while the size is unknown after compaction.
  - Prompt-cache read/write (`cache R424.0k/W2.1k`).
  - Subscription quota windows with local reset times (`5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00`), labeled from each window's reported length.
  - Session duration measured from the session header, so resumed sessions keep their age.
  - Git branch with dirty, ahead, and behind markers; a detached HEAD shows its short commit id.
  - Optional Context Mode "this chat" amount (`ctx-mode 426KB`).
- Quota support for OpenAI Codex, OpenCode Go, and Command Code (using the `cmd` CLI credential).
- Width-aware rendering that keeps two lines and drops detail by priority on narrow terminals.
- `PI_FOOTER_SHOW_CWD`, `PI_FOOTER_SHOW_BRANCH`, `PI_FOOTER_SHOW_PROVIDER`, and `PI_FOOTER_SHOW_CONTEXT_MODE`; the original `PI_MINIMAL_FOOTER_*` names keep working as fallbacks.
- Vitest test suite, TypeScript checking, and CI with a Pi 1.0.0 minimum-compatibility job.

### Changed (from `pi-minimal-footer`)

- The working directory is hidden by default.
- Quota is shown only for the current model's provider; after a provider switch, another provider's quota is never displayed.

### Removed (from `pi-minimal-footer`)

- Quota support for Claude Max, GitHub Copilot, Google Gemini, MiniMax, MiniMax CN, and Kimi Coding.
- The screenshots of the original footer design.
