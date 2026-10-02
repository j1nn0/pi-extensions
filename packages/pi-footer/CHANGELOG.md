# Changelog

## [Unreleased]

### Changed

- Redesign the footer as a two-line Claude Code StatusLine-style display: `model · level · think ON │ ctx <10-cell bar> N% · used/window [! | ⚠ | COMPACT] │ cache R/W` and `quota windows │ duration │ branch │ ctx-mode`, dropping detail by priority on narrow terminals instead of wrapping into extra lines.
- Read the context gauge from Pi's `ctx.getContextUsage()` and show `?%` while Pi does not know the context size after a compaction.
- Read the thinking level from Pi's live `ctx.thinkingLevel`.
- Show quota percentages rounded down with local reset times (`↻ HH:MM`, `↻ MM/DD HH:MM`) and compact labels (`5h`, `7d`, `mo`); windows are labeled from their reported length (for example `8h`) instead of defaulting to `5h`.
- Format token counts with one decimal (`424.5k`, `1.0M`).
- Hide the working directory by default; enable it with `PI_FOOTER_SHOW_CWD=1`.
- Show a detached HEAD as its short commit id.
- Rename the configuration variables to `PI_FOOTER_*`; the `PI_MINIMAL_FOOTER_*` names keep working as fallbacks.

### Added

- Command Code subscription usage (5-hour and weekly windows) using the `cmd` CLI credential.
- Prompt-cache read/write segment.
- Session duration measured from the session header, so resumed sessions keep their age.
- Optional Context Mode "this chat" segment (`ctx-mode`), disabled with `PI_FOOTER_SHOW_CONTEXT_MODE=0`.

### Removed

- Quota support for Claude Max, GitHub Copilot, Google Gemini, MiniMax, MiniMax CN, and Kimi Coding.
- The screenshots of the previous footer design.

## Standalone conversion

- Convert the `pi-minimal-footer` package from the `ogulcancelik/pi-extensions` monorepo into the standalone `@j1nn0/pi-footer` package.
- Target Pi 1.0 (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` `>=1.0.0` as peer dependencies) and Node.js `>=22.19.0`.
- Split the single-file implementation into modules under `src/` without changing footer output or provider behavior.
- Add Vitest characterization and unit tests, TypeScript checking, and CI workflows.
