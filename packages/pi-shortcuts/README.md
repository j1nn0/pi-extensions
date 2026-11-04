# @j1nn0/pi-shortcuts

Storage foundation for reusable Pi shortcuts. This release validates, normalizes, and persists
shortcut records to a user-global directory; it does not create shortcuts yet.

## Status

Implemented in this release:

- Shortcut name normalization and validation.
- `schemaVersion: 1` record validation.
- File-backed store with atomic writes, overwrite protection, a size cap, and symlink refusal.
- `saveShortcut`, `loadShortcut`, `getShortcut`, `existsShortcut`, and `listShortcuts`.

Not implemented yet:

- `/shortcut` command and any other user-facing command.
- LLM-assisted shortcut authoring and session-history parsing.
- Parameter substitution and rerun of a stored procedure.

The extension entrypoint therefore registers no commands or tools. Installing the package today
only exposes the storage API to other code in the same Pi process.

## Install

```text
pi install npm:@j1nn0/pi-shortcuts
```

Installing is optional for now: without a command, the package changes nothing you can see.

## Storage location

Shortcuts live in `<Pi agent dir>/shortcuts/<name>.json`. The agent dir comes from Pi's public
`getAgentDir()` helper, so `PI_CODING_AGENT_DIR` is honoured and the default is `~/.pi/agent`.
Every store function also accepts an `agentDir` override for tests and embedding.

```text
~/.pi/agent/shortcuts/
  review-diff.json
  release-notes.json
```

## Record format

```json
{
  "schemaVersion": 1,
  "name": "review-diff",
  "description": "Review the current diff",
  "procedure": "Review the diff and list risky changes.",
  "params": ["target"],
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-01-02T03:04:05.000Z",
  "source": {
    "sessionId": "session-1",
    "range": { "fromEntryId": "entry-1", "toEntryId": "entry-2" },
    "cwd": "/home/user/project",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

Rules enforced by validation:

- `schemaVersion` must be exactly `1`; any other value is rejected as an unknown schema version.
- `name` must already be a canonical slug (see below) and must match the file name.
- `description` is a string and may be empty; `procedure` must be a non-empty string.
- `params` is the minimal string-array form: each entry is a placeholder name of 1-32 letters,
  digits, `_`, or `-`, starting with a letter or digit, and names must be unique
  (case-insensitive). Object definitions such as `{ "name": "target" }` are rejected.
- `createdAt` and `updatedAt` must be canonical ISO 8601 UTC timestamps in `toISOString()` form.
- `source` requires `sessionId`, `range.fromEntryId`, `range.toEntryId`, `cwd`, and `model`, all
  non-empty strings.
- Unknown top-level fields are dropped on read.

### Name rules

Names are normalized with NFKC, trimmed, lowercased, and have whitespace/underscore runs collapsed
to a single hyphen. The result must match `[a-z0-9]+(-[a-z0-9]+)*` and be at most 64 characters.
Empty names, path separators, `..`, leading dots, leading/trailing hyphens, and other characters
(for example `café` or `日本語`) are rejected. Non-ASCII names are refused rather than
transliterated, so the on-disk name always equals the requested slug.

## API

| Function | Behavior |
| --- | --- |
| `normalizeShortcutName(raw)` | Pure normalization/validation; returns `{ ok: true, name }` or `{ ok: false, code, message }`. |
| `parseShortcut(value)` | Pure `schemaVersion: 1` validation; returns the canonical record or a failure. |
| `parseShortcutJson(text)` | Same as `parseShortcut`, plus a `corrupt-json` failure for unparseable text. |
| `serializeShortcut(record)` | Stable JSON for an already validated record (trailing newline). |
| `resolveShortcutsDir({ agentDir? })` | Store directory, derived from `getAgentDir()` unless overridden. |
| `saveShortcut(record, { agentDir?, overwrite? })` | Atomic save; refuses to replace an existing shortcut unless `overwrite: true`. |
| `loadShortcut(name, { agentDir? })` | Full result with a typed error code. |
| `getShortcut(name, { agentDir? })` | The record, or `null` when missing, invalid, or unreadable. |
| `existsShortcut(name, { agentDir? })` | `true` only when a regular, non-symlink file exists; invalid names return `false`. |
| `listShortcuts({ agentDir? })` | `{ shortcuts, skipped }`, sorted by name; unreadable files are reported, not deleted. |

Every filesystem function returns `{ ok: true, value }` or `{ ok: false, error: { code, message } }`
and never throws for expected failures. Error codes are `invalid-name`, `invalid-record`,
`corrupt-json`, `unknown-schema-version`, `not-found`, `already-exists`, `too-large`,
`unsafe-path`, `unsupported-entry`, and `io-error`.

## Write and read guarantees

- Writes go to a uniquely named temp file in the same directory, are fsynced, then committed with
  `link()` (fails with `already-exists` if the target appeared) or `rename()` when `overwrite: true`.
  A failed write leaves the previous file intact and removes the temp file.
- Files are capped at 64 KiB on both save and read.
- New store directories use mode `0700` and new files use `0600`; an existing directory's mode is
  left alone. `chmod` runs after creation so a permissive umask does not widen the mode.
- Symlinked store directories, symlinked shortcut files, and entries whose real path resolves
  outside the store are refused.
- Corrupt JSON and unknown `schemaVersion` values are rejected on read. `listShortcuts` skips such
  files and reports them in `skipped` without deleting or moving them.

## Limits

- Symlink checks are path-based. Node has no directory-fd `link`/`rename`, so a local attacker who
  can rewrite the store directory between the check and the commit is out of scope.
- Creating a new shortcut requires hard links. Where `link()` is unavailable or refused (`EPERM`,
  `ENOSYS`, `ENOTSUP`, `EOPNOTSUPP`, `EXDEV`), a new save fails with `io-error` instead of risking an
  unintended overwrite; explicit overwrites still use `rename()`.
- Directory fsync is best-effort; it is unsupported on some platforms (notably Windows).
- File modes are best-effort on Windows, where POSIX mode bits do not apply.
- Windows reserved device names (for example `con`) are not filtered by name validation; saving one
  fails with `io-error` rather than being renamed.
- There is no locking, no cross-process queue, and no last-write-wins: a concurrent creator either
  wins or receives `already-exists`.
