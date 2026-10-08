# @j1nn0/pi-exit

A guarded `/exit` command for Pi. When an agent run is in progress, `/exit` asks before interrupting it. If dialog UI is unavailable or confirmation fails, it exits anyway.

## Install

```text
pi install npm:@j1nn0/pi-exit
```

## Usage

| Command | Behavior |
| --- | --- |
| `/exit` | Exit now; asks for confirmation while the agent is running. |
| `/exit --force` | Exit without confirmation. |
| `/exit --wait` | Wait for the agent to finish, then exit. |
| `/exit --help` | Show command help. |

## Differences from pi-exit

The default now confirms before interrupting a running agent. Use `--force` to restore unconditional exit behavior.

Pi 1.0 ships `/quit`; this extension provides a guarded `/exit` command for muscle memory.

## Migrating from `npm:pi-exit`

Do not load both packages at the same time. If the original `npm:pi-exit` is still configured, Pi may namespace this package's command as `exit:1` instead of binding it to `/exit`, so `/exit` would keep running the old extension.

Remove the old `npm:pi-exit` package from your Pi configuration before installing `@j1nn0/pi-exit`.
