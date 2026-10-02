# Contributor and agent guidance

## Communication

- Use Japanese only for user-facing communication.
- Use English for all non-user-facing communication and generated artifacts unless the repository, task, or existing content requires another language.
- Use English for agent-to-agent communication, delegation prompts, plans, findings, summaries, intermediate reports, tool-related annotations, code comments, documentation, and commit messages.
- Keep non-user-facing communication concise and information-dense. Do not restate context already available to the receiving agent.
- Preserve the language of existing content when editing it unless the task explicitly requires changing it.

## Implementation

- `src/index.ts` owns Pi event handlers and background refreshes; keep `src/render.ts` free of I/O and use Pi TUI width helpers for rendered text.
- Scope quota data to the active provider. Discard responses from a provider that is no longer active, and preserve cached values on transient failures.
- Keep credentials out of rendered text and logs.

## Verification

- Add focused tests under `test/` for changed behavior, then run `pnpm check` and `pnpm test`. Run `pnpm pack:check` for packaging changes.
