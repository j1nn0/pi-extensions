# pi-herdr-worktree-jump

Jump an active [Pi](https://github.com/earendil-works/pi) session into a newly created [Herdr](https://github.com/herdrdev/herdr) Git worktree or back to the repository's main checkout while preserving its conversation.

## Install

```bash
pi install npm:@ogulcancelik/pi-herdr-worktree-jump
```

For local development:

```bash
pi install ~/Projects/pi-extensions/packages/pi-herdr-worktree-jump
```

The extension activates only when Pi runs inside a Herdr-managed pane with `HERDR_ENV=1`.

## Tool

### `herdr_worktree_jump`

The tool:

1. Uses `herdr worktree list --cwd <pi-cwd>` to resolve the repository's source checkout, including when Pi is already inside a linked worktree.
2. With `destination: "new"` (the default), creates and focuses a new worktree workspace with `herdr worktree create`.
3. With `destination: "main"`, opens and focuses the source checkout with `herdr worktree open`. If its workspace is already open, the tool creates a fresh tab rather than replacing a process in an occupied pane.
4. Forks the persisted Pi session into the destination checkout and starts the replacement Pi in its dedicated pane.
5. Shuts down the old Pi process, deletes its old session file, and closes its pane.

For `destination: "new"`, optional parameters select the branch, base ref, and Herdr workspace label. Herdr generates a branch when none is supplied and uses `HEAD` when no base is supplied.

## Invocation policy

This tool performs an explicit session relocation. The model is instructed to call it only when the user explicitly asks to jump or move the current Pi session into a new worktree or back to the main checkout. It must not infer that request from repository worktree guidance or from a task that would benefit from isolation.

## Requirements

- Pi 0.80 or newer
- Herdr 0.8.0 or newer
- Pi running inside a Herdr pane
- A persisted Pi session
- `sh` plus `setsid` or `nohup` for old-pane cleanup

## License

MIT
