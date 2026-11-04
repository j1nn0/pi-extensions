import { SHORTCUT_SCHEMA_VERSION, type Shortcut } from "../src/schema.ts";

/** Builds a valid schemaVersion 1 record; override only the fields a test cares about. */
export function makeShortcut(overrides: Partial<Shortcut> = {}): Shortcut {
  return {
    schemaVersion: SHORTCUT_SCHEMA_VERSION,
    name: "review-diff",
    description: "Review the current diff",
    procedure: "Review the diff and list risky changes.",
    params: ["target"],
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    source: {
      sessionId: "session-1",
      range: { fromEntryId: "entry-1", toEntryId: "entry-2" },
      cwd: "/tmp/project",
      model: "anthropic/claude-sonnet-4",
    },
    ...overrides,
  };
}
