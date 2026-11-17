# @j1nn0/pi-footer

A Pi extension that replaces Pi's default footer with a compact two-line status
display showing model and thinking state, context usage, prompt-cache usage,
subscription quota windows with reset times, session duration, Git state, the
optional [pi-goal](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)
state, and the optional Context Mode produced-bytes amount.

This project is a standalone fork of [`pi-minimal-footer`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-minimal-footer)
by Can Celik, originally published as `@ogulcancelik/pi-minimal-footer` in the
`ogulcancelik/pi-extensions` monorepo.

```text
deepseek-v4.1-flash · max · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k │ cache R424.0k/W2.1k
5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00 │ 6h29m │ main * ↑2 │ 🎯 goal 12/100 │ ctx-mode 426.0 KB
```

## Requirements

- Pi `>= 1.0.0` (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are peer dependencies provided by Pi)
- Node.js `>= 22.19.0` (Pi 1.0's own requirement)
- Optional: [Context Mode](https://github.com/mksglu/context-mode) 2.x for the `ctx-mode` segment
- Optional: [`@narumitw/pi-goal`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) for the `🎯` segment

## Installation

```bash
pi install npm:@j1nn0/pi-footer
```

Install the package from npm; the monorepo root itself cannot be installed as a Pi extension:

```bash
pi install npm:@j1nn0/pi-footer
```

To try the local package for a single session, run from `packages/pi-footer/`:

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

### Line 2 — quota, duration, Git, Goal, Context Mode

```text
<window> <used%> ↻ <reset> │ ... │ <duration> │ [cwd] │ <branch> │ 🎯 <goal> │ ctx-mode <amount>
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
- **Goal** — `🎯` followed by the state [pi-goal](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)
  publishes through Pi's extension status API (see [Goal status](#goal-status)).
- **Context Mode** — `ctx-mode <amount>`: how many bytes Context Mode's tools
  produced in the current Pi session — the "made" column of `ctx_stats`, not the
  bytes that reached the chat. It is formatted the way Context Mode formats
  bytes (`426.0 KB`, `1.2 MB`); lifetime, per-tool, and percentage details are
  not shown.

### Narrow terminals

The footer keeps two lines and drops detail by priority as the width shrinks:

- Line 1: cache, then `think ON`, then token counts, then the thinking level,
  then the bar. The model name is shortened before the context percentage is
  dropped.
- Line 2: Context Mode, then cwd, then duration, then reset times, then quota
  windows from the last one, then the Goal turn counter. The branch and the Goal
  state stay longest.

Every line is truncated to the terminal width with ANSI-aware Pi TUI helpers.

```text
# 80 columns
gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k
5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ 🎯 goal 12/100

# 40 columns
gpt-6-luna · high │ ctx ████░░░░░░ 41%
5h 71% │ main * ↑2 │ 🎯 goal 12/100

# 20 columns
gpt-6-luna │ ctx 41%
main * ↑2 │ 🎯 goal
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
- Context Mode is read from its local database in the background at session
  start and at the end of every turn; the last value is kept if a later read
  fails.
- Goal status is read from Pi's extension status map on every render; Pi
  re-renders the footer when an extension publishes a status, so no timer or
  polling is involved.
- Rendering itself performs no network requests, process launches, or file
  reads. The Context Mode segment is read ahead of the render and only its
  cached string is drawn.

## Context Mode

Context Mode 2.x is optional and not a dependency. It has no statusline command
and publishes nothing through Pi's extension status API, so the footer reads the
same local SQLite database that Context Mode's own `ctx_stats` tool reads:

- **Where** — `<data root>/projects/<project key>/context.db`, where the data
  root is `$CONTEXT_MODE_DATA_DIR` or `~/.context-mode`, and the project key is
  `sha256(<git common dir of the Pi working directory>)[0:16]` — the real path of
  the working directory itself outside a Git repository. Linked worktrees share
  their main repository's key, exactly as in Context Mode.
- **What** — the terminal `ctx_stats` "made" total for this session:
  `SUM(sandbox_bytes)` over the session's rows with a tool, excluding cost rows
  and `ctx_stats` itself, using Context Mode's own `CALLS` predicate. The Pi
  session id is the UUID Pi assigns, which Context Mode stores verbatim.
- **How** — one read-only connection (5 second lock timeout), one aggregate
  query, closed immediately. Nothing is created, migrated, or written: the
  connection is read-only, and a missing database file fails to open instead of
  being created. The read runs at session start, when Pi re-registers the footer
  for a resumed, new, or forked session, and at the end of every turn, in the
  background, never inside `render()`.

If Context Mode is not installed, has no database for this project, has no calls
for this session yet, or the database cannot be opened or read, the segment is
omitted without any warning and the rest of the footer is unaffected. A failed
read keeps the previous value; switching sessions discards it. Set
`PI_FOOTER_SHOW_CONTEXT_MODE=0` to never read the database.

Context Mode 1.x stores its state elsewhere and has no `projects/<key>/context.db`,
so a 1.x install simply keeps the segment hidden.

## Goal status

[pi-goal](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)
is optional and not a dependency. When it is installed, it publishes its state
with `ctx.ui.setStatus("goal", …)`; the footer reads that value with Pi's
public `getExtensionStatuses()` and shows it on line 2. Without pi-goal the
segment is simply absent and nothing else changes.

The state strings are the ones pi-goal's `formatStatus` produces:

| Goal state       | Display           | Colour  |
| ---------------- | ----------------- | ------- |
| `active`         | `🎯 goal 12/100`  | success |
| `waiting`        | `🎯 waiting`      | warning |
| `paused`         | `🎯 paused`       | warning |
| `blocked`        | `🎯 blocked`      | error   |
| `usage_limited`  | `🎯 usage limit`  | error   |
| `budget_limited` | `🎯 budget limit` | error   |
| `complete`       | `🎯 complete`     | success |

`12/100` is pi-goal's automatic continuation counter
(`automaticModelTurns`/`automaticTurns`). With an unlimited automatic limit, or
whenever the counter is not reported, the segment is just `🎯 goal`. The footer
recognizes `waiting` and `complete` verbatim and the other states only when they
carry pi-goal's ` automatic …` suffix; anything else is omitted rather than
guessed.

The footer is passive here: it keeps no Goal state of its own, so a new or
resumed session shows whatever pi-goal publishes for that session. pi-goal
clears its own status after a completion, so `🎯 complete` disappears without a
footer-side timer.

## Configuration

Optional environment variables, read when the extension is loaded. Each
`PI_FOOTER_*` variable takes precedence; the legacy `PI_MINIMAL_FOOTER_*` name
from the original package is used when the new one is unset, empty, or invalid.

| Variable                       | Legacy name                       | Description                                       | Default |
| ------------------------------ | --------------------------------- | ------------------------------------------------- | ------- |
| `PI_FOOTER_SHOW_CWD`           | `PI_MINIMAL_FOOTER_SHOW_CWD`      | Show the working directory on line 2              | `0`     |
| `PI_FOOTER_SHOW_BRANCH`        | `PI_MINIMAL_FOOTER_SHOW_BRANCH`   | Show Git branch, dirty marker, and ahead/behind   | `1`     |
| `PI_FOOTER_SHOW_PROVIDER`      | `PI_MINIMAL_FOOTER_SHOW_PROVIDER` | Show `provider/model-id` instead of the short ID  | `0`     |
| `PI_FOOTER_SHOW_CONTEXT_MODE`  | —                                 | Read Context Mode and show `ctx-mode`             | `1`     |
| `PI_FOOTER_SHOW_GOAL`          | —                                 | Show the pi-goal state on line 2                  | `1`     |

True values: `1`, `true`, `yes`, `on`. False values: `0`, `false`, `no`, `off`.
Values are case-insensitive and trimmed.

## Security

Credentials are read from the locations listed above only when a quota request
is made. They are sent only to the corresponding provider's own endpoints, are
never rendered, logged, or included in error values, and are not written
anywhere. Command Code organization ids are cached in memory keyed by a hash of
the API key, not the key itself. Context Mode is read from its local database
with a read-only connection; only one aggregate byte count is kept, and no
session content, tool output, or file path leaves the process.

For security concerns and vulnerability reporting, see the [repository security policy](../../SECURITY.md).

## Known limitations

- **Command Code monthly allowance** — the API does not report a monthly usage
  percentage; the `cmd` CLI derives it from a plan table built into the CLI, so
  the footer shows only the 5-hour and weekly windows.
- **Undocumented endpoints** — the Codex (`chatgpt.com/backend-api/wham/usage`),
  OpenCode Go, and Command Code (`/alpha/...`) quota APIs are internal and may
  change without notice.
- **Context Mode coupling** — the `ctx-mode` segment relies on Context Mode
  2.x's on-disk layout (`~/.context-mode/projects/<sha256(project root)[0:16]>/
  context.db`, the `events` table, the raw Pi session id, and the `CALLS`
  predicate of `ctx_stats`) as of Context Mode 2.2.0. It is undocumented
  internals rather than an interface; a future release that moves the database
  or renames a column hides the segment instead of showing a wrong number.
- **Context Mode cost** — the read is synchronous inside the refresh, so a turn
  boundary waits a few milliseconds for one indexed aggregate query; nothing is
  read during rendering and no timer polls the database.
- **Context Mode on Node 22** — `node:sqlite` is loaded the first time a Context
  Mode database is read. Node 22 prints its one-time
  `ExperimentalWarning: SQLite is an experimental feature` on stderr when that
  happens; Node 24 does not. Nothing else in the footer loads it.
- **Goal status coupling** — the `🎯` segment parses the text pi-goal publishes
  through `ctx.ui.setStatus("goal", …)`, as of `@narumitw/pi-goal` 0.55.x. It
  accepts `waiting` and `complete` verbatim and the other states only when they
  carry pi-goal's ` automatic …` suffix. Anything else — including a
  status another extension published under the same `goal` key, or a future
  pi-goal wording that no longer matches — is omitted instead of guessed, and
  the rest of the footer keeps working.
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

Tests run against Pi 1.0 with mocked provider responses and local fixture
Context Mode databases created from its published schema; they never make
network requests and never run the `context-mode` command.

## License

MIT License. See [LICENSE](LICENSE).

Based on `pi-minimal-footer`, Copyright (c) 2025 Can Celik, licensed under the
MIT License.
