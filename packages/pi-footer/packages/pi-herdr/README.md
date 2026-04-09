# pi-herdr

Herdr-native pane, tab, and workspace orchestration for [pi](https://github.com/badlogic/pi-mono). Run commands in sibling panes, read output, wait for readiness, coordinate with other agents, and organize work across tabs and workspaces without falling back to tmux choreography.

## Install

```bash
pi install npm:@ogulcancelik/pi-herdr
```

Or add manually to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:@ogulcancelik/pi-herdr"]
}
```

## What it does

Gives the agent a `herdr` tool with these actions:

| Action | Description |
|--------|-------------|
| **list** | List panes in the current herdr workspace |
| **workspace_list** | List workspaces |
| **workspace_create** | Create a workspace |
| **workspace_focus** | Focus a workspace |
| **tab_list** | List tabs in a workspace |
| **tab_create** | Create a tab |
| **tab_focus** | Focus a tab |
| **focus** | Focus a workspace, tab, or the tab containing a pane |
| **run** | Split a sibling pane and run a command there |
| **read** | Read output from a pane |
| **watch** | Wait until pane output matches text or regex |
| **wait_agent** | Wait until another agent pane reaches a specific status |
| **send** | Send literal text or keys to a pane |
| **stop** | Close a pane |

## Why this exists

This replaces the most common `pi-tmux` workflow with herdr's native CLI wrappers:

- `herdr workspace ...`
- `herdr tab ...`
- `herdr pane split`
- `herdr pane run`
- `herdr pane read`
- `herdr wait output`
- `herdr wait agent-status`
- `herdr pane close`

That means the agent can do higher-level pane workflows with fewer brittle steps and better awareness of agent completion states like `done`.

## Defaults and behavior

- The extension returns early unless `HERDR_ENV` exists and `HERDR_PANE_ID` is present, so the `herdr` tool is not registered at all outside herdr
- Panes can be referenced by friendly aliases like `server` or `tests`, or directly by real herdr pane ids
- Alias state is stored in tool result details and reconstructed on session load and branch changes
- First worker pane splits to the right of the current pane
- Additional worker panes stack downward below the most recently created managed pane
- `watch` uses `herdr wait output`
- `wait_agent` uses `herdr wait agent-status`
- `read` and `watch` support `visible`, `recent`, and `recent-unwrapped`

## Agent status semantics

When using `wait_agent`, herdr statuses mean:

- `working` — the agent is actively processing
- `blocked` — the agent needs user input or approval
- `done` — the agent finished in a background pane and you have not looked at it yet
- `idle` — the agent finished and the pane has already been seen
- `unknown` — no recognized agent is detected

Important workflow tips:

- if you start another agent in a background pane and want to wait for completion, **usually wait for `done`**
- if the pane is focused while the agent finishes, expect **`idle`** instead
- do **not** treat `blocked` as generic startup readiness

## Starting another pi cleanly

A good pattern for a fresh sibling agent is:

```json
{ "action": "run", "pane": "reviewer", "command": "pi --no-session --model openai-codex/gpt-5.4-mini" }
```

If model choice matters and the user has not specified one, the agent should ask which model/provider to use.

## Example workflows

Run a server in a sibling pane:

```json
{ "action": "run", "pane": "server", "command": "bun run dev" }
```

Wait for readiness with regex:

```json
{ "action": "watch", "pane": "server", "match": "ready|listening on", "regex": true, "timeout": 30000 }
```

Read recent unwrapped logs:

```json
{ "action": "read", "pane": "server", "source": "recent-unwrapped", "lines": 40 }
```

Create a tab and remember its root pane:

```json
{ "action": "tab_create", "workspace": "1", "pane": "reviewer" }
```

Wait for another agent to finish in the same sense the UI shows:

```json
{ "action": "wait_agent", "pane": "reviewer", "status": "done", "timeout": 300000 }
```

Focus the tab containing an existing pane id:

```json
{ "action": "focus", "pane": "w64eca6cb07ad62-2" }
```

List workspaces and tabs:

```json
{ "action": "workspace_list" }
```

```json
{ "action": "tab_list", "workspace": "1" }
```

## Notes for agents

- `run` still defaults to creating a sibling pane and keeping focus on the current pane. Pass `focus: true` if you want the new pane's tab active immediately.
- `tab_create` and `workspace_create` can also take `focus: false` to preserve the current context.
- If you already know a real pane id from `list` or another herdr response, you can use it directly in `read`, `watch`, `wait_agent`, `send`, `stop`, or `focus`, even outside the alias map.
- Herdr does not currently expose direct pane focus. `focus` with a pane id focuses the pane's tab.

## Requirements

- [pi](https://github.com/badlogic/pi-mono) v0.40+
- [herdr](https://github.com/ogulcancelik/herdr)
- pi must be running inside a herdr pane

## License

MIT
