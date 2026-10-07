# @j1nn0/pi-footer

A Pi extension that replaces Pi's default footer with a compact two-line status
display showing model and thinking state, context usage, prompt-cache usage,
subscription quota windows with reset times, session duration, Git state, and
the optional Context Mode "this chat" amount.

This project is a standalone fork of [`pi-minimal-footer`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-minimal-footer)
by Can Celik, originally published as `@ogulcancelik/pi-minimal-footer` in the
`ogulcancelik/pi-extensions` monorepo.

```text
deepseek-v4.1-flash · max · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k │ cache R424.0k/W2.1k
5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB
```

## Requirements

- Pi `>= 1.0.0` (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are peer dependencies provided by Pi)
- Node.js `>= 22.19.0` (Pi 1.0's own requirement)
- Optional: [Context Mode](https://github.com/mksglu/context-mode) for the `ctx-mode` segment

## Installation

```bash
pi install npm:@j1nn0/pi-footer
```

Or install the latest `main` from GitHub:

```bash
pi install git:github.com/j1nn0/pi-footer
```

To try it for a single session from a local checkout:

```bash
pi -e ./index.ts
```

## What it shows

### Line 1 — model, thinking, context, cache

```text
<model> · <thinking level> · think ON │ ctx <bar> <used%> · <tokens>/<window> [warning] │ cache R<read>/W<write>
```

- **Model** — the last path segment of the model ID (`deepseek-v4.1-flash`),
  or `provider/model-id` when `PI_FOOTER_SHOW_PROVIDER` is enabled.
- **Thinking** — for reasoning models, Pi's live thinking level
  (`ctx.thinkingLevel`) followed by `think ON`, or `think OFF` when the level is
  `off`. Non-reasoning models show neither.
- **Context gauge** — a 10-cell bar, the used percentage (rounded down), and
  token counts from Pi's own `ctx.getContextUsage()`. Warnings: `!` from 70%,
  `⚠` from 85%, `COMPACT` from 95%. Right after a compaction, before the next
  response, Pi does not know the context size; the gauge then shows
  `ctx ░░░░░░░░░░ ?% · ?/384.0k` instead of a misleading number.
- **Cache** — prompt-cache tokens of the latest completed assistant response:
  `R` (cache read) when above zero and `W` (cache write) from 1k. The segment is
  omitted when neither applies or after a compaction.

Token counts use one decimal: `950`, `424.5k`, `1.0M`.

### Line 2 — quota, duration, Git, Context Mode

```text
<window> <used%> ↻ <reset> │ ... │ <duration> │ [cwd] │ <branch> │ ctx-mode <amount>
```

- **Quota windows** — the subscription windows of the current model's provider
  (see below), each with the used percentage (rounded down) and, when the
  provider reports one, the local reset time: `↻ HH:MM` for windows measured
  in hours, `↻ MM/DD HH:MM` for longer windows. Percentages are yellow from 85%
  and red from 92%.
- **Duration** — wall-clock age of the logical Pi session, `42m` or `2h03m`
  (hours keep counting past a day, e.g. `28h04m`). It is measured from the
  session header timestamp, so resumed sessions keep their age; forked sessions
  start a new header and a new age. The footer re-renders once a minute.
- **cwd** — optional, off by default (see Configuration).
- **Git** — branch name, ` *` when the working tree has changes, `↑N` ahead and
  `↓N` behind its upstream. A detached HEAD shows its short commit id.
- **Context Mode** — `ctx-mode <amount>`: Context Mode's "this chat" amount for
  the current Pi session. Lifetime statistics and other Context Mode details are
  not shown.

### Narrow terminals

The footer keeps two lines and drops detail by priority as the width shrinks:

- Line 1: cache, then `think ON`, then token counts, then the thinking level,
  then the bar. The model name is shortened before the context percentage is
  dropped.
- Line 2: Context Mode, then cwd, then duration, then reset times, then quota
  windows from the last one. The branch stays longest.

Every line is truncated to the terminal width with ANSI-aware Pi TUI helpers.

```text
# 80 columns
gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k
5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB

# 40 columns
gpt-6-luna · high │ ctx ████░░░░░░ 41%
5h 71% │ 7d 14% │ main * ↑2
```

## Supported providers

Quota windows are shown only for these providers. Other models still get every
other segment.

| Provider     | Detected by                                                            | Windows                                   | Credentials (in lookup order)                                                                        |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| OpenAI Codex | Pi provider `openai-codex`                                             | primary (`5h`), secondary (`7d`)          | `openai-codex.access` (+ `accountId`) in Pi's `auth.json`; `$CODEX_HOME/auth.json` or `~/.codex/auth.json` |
| OpenCode Go  | Pi provider `opencode-go`                                              | `5h`, `7d`, `mo`                          | `OPENCODE_API_KEY`; `opencode-go` in Pi's `auth.json`                                                |
| Command Code | a Pi provider whose `baseUrl` host is `api.commandcode.ai`             | `5h`, `7d`                                | `COMMAND_CODE_API_KEY`; `apiKey` in `~/.commandcode/auth.json` (written by `cmd login`)              |

- Codex window labels come from the reported window length (for example `8h`);
  `5h`/`7d` are used only when the length is missing.
- Command Code is configured in Pi as a custom provider in `models.json`, so it
  is recognized by its API host rather than by its user-chosen provider id or
  by model ids, which other providers may share. The footer reads the same
  credential as the `cmd` CLI and calls the same read-only endpoints the CLI's
  usage view uses (`/alpha/whoami` once per process for the organization id,
  then `/alpha/billing/credits`). The percentage is `used / cap` of each window.
- Pi's `auth.json` is `~/.pi/agent/auth.json` (populated by `/login`). For
  OpenCode Go, an entry may be a string or an object with `key`, `access`, or
  `refresh`; the value may name an environment variable or start with `!` to
  run a command whose output is the key, matching Pi's own conventions.

## Refresh behavior

- Quota is fetched when the footer is created at session start, immediately
  when the model changes, and every 5 minutes for the active provider. Requests
  time out after 5 seconds. Models from other providers make no quota requests
  and run no refresh timer.
- Results are cached per provider for the lifetime of the Pi process. After a
  model switch, the new provider's cached values are shown immediately while a
  fresh request runs; without a cache, no quota is shown until the first
  response arrives. Another provider's quota is never shown.
- When a refresh fails, the provider's previous values stay visible.
- Git state is read with `git status --porcelain=v2 --branch` (1 second
  timeout) in the directory Pi was started from, at session start, when Pi
  reports a branch change, and at the end of every turn.
- Context Mode is queried in the background at session start and at the end of
  every turn; the last value is kept if a later query fails.
- Rendering itself performs no network requests, process launches, or file
  reads.

## Context Mode

Context Mode is optional and not a dependency. When the `context-mode` command
is on `PATH`, the footer runs `context-mode statusline` (3 second timeout) with
the Pi session id that Context Mode's Pi adapter uses and with
`CLAUDE_CONFIG_DIR=~/.pi`, so the statusline reads the Pi adapter's session
store (`~/.pi/context-mode/sessions`). Only the `<number><unit> this chat` value
is extracted from its output.

If Context Mode is not installed, fails, times out, has no data for the session
yet, or prints something else, the segment is omitted without any warning. Set
`PI_FOOTER_SHOW_CONTEXT_MODE=0` to never run it.

## Configuration

Optional environment variables, read when the extension is loaded. Each
`PI_FOOTER_*` variable takes precedence; the legacy `PI_MINIMAL_FOOTER_*` name
from the original package is used when the new one is unset, empty, or invalid.

| Variable                       | Legacy name                       | Description                                       | Default |
| ------------------------------ | --------------------------------- | ------------------------------------------------- | ------- |
| `PI_FOOTER_SHOW_CWD`           | `PI_MINIMAL_FOOTER_SHOW_CWD`      | Show the working directory on line 2              | `0`     |
| `PI_FOOTER_SHOW_BRANCH`        | `PI_MINIMAL_FOOTER_SHOW_BRANCH`   | Show Git branch, dirty marker, and ahead/behind   | `1`     |
| `PI_FOOTER_SHOW_PROVIDER`      | `PI_MINIMAL_FOOTER_SHOW_PROVIDER` | Show `provider/model-id` instead of the short ID  | `0`     |
| `PI_FOOTER_SHOW_CONTEXT_MODE`  | —                                 | Query Context Mode and show `ctx-mode`            | `1`     |

True values: `1`, `true`, `yes`, `on`. False values: `0`, `false`, `no`, `off`.
Values are case-insensitive and trimmed.

## Security

Credentials are read from the locations listed above only when a quota request
is made. They are sent only to the corresponding provider's own endpoints, are
never rendered, logged, or included in error values, and are not written
anywhere. Command Code organization ids are cached in memory keyed by a hash of
the API key, not the key itself. Context Mode output is reduced to the parsed
"this chat" amount.

## Known limitations

- **Command Code monthly allowance** — the API does not report a monthly usage
  percentage; the `cmd` CLI derives it from a plan table built into the CLI, so
  the footer shows only the 5-hour and weekly windows.
- **Undocumented endpoints** — the Codex (`chatgpt.com/backend-api/wham/usage`),
  OpenCode Go, and Command Code (`/alpha/...`) quota APIs are internal and may
  change without notice.
- **Context Mode coupling** — the `ctx-mode` segment relies on Context Mode's
  Pi adapter storing sessions under `~/.pi/context-mode/sessions` with session
  ids derived from the Pi session file path, as of Context Mode 1.0.169.
- **Missing credentials or failed requests** — the quota windows are simply not
  shown; no error is displayed.
- The footer replaces Pi's default footer entirely.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm pack:check
```

Tests run against Pi 1.0 with mocked provider responses and a mocked
`context-mode` command; they never make network requests.

## License

MIT License. See [LICENSE](LICENSE).

Based on `pi-minimal-footer`, Copyright (c) 2025 Can Celik, licensed under the
MIT License.
