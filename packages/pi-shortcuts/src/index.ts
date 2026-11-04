import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export * from "./name.ts";
export * from "./schema.ts";
export * from "./store.ts";

/**
 * Storage-only build of pi-shortcuts.
 *
 * Shortcut creation (LLM), history parsing, the `/shortcut` command, and rerun
 * are not implemented yet, so this factory registers nothing. It exists because
 * Pi's extension loader rejects a package entrypoint without a default export.
 */
export default function piShortcuts(_pi: ExtensionAPI): void {}
