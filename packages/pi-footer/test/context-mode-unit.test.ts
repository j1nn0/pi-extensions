import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContextModeTracker,
  contextModeDatabasePath,
  contextModeProjectKey,
  formatContextModeBytes,
  readContextModeBytes,
  type ContextModeReadInput,
  type ContextModeReader,
} from "../src/context-mode.ts";

/** Verbatim from context-mode 2.2.0 (`src/core/store/schema.ts`); only `events` is read. */
const EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  worktree       TEXT NOT NULL,
  agent          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('prompt','edit','cmd','toolerr','index','cost','decision')),
  tool           TEXT,
  key            TEXT,
  path           TEXT,
  ok             INTEGER,
  exit_code      INTEGER,
  bytes          INTEGER,
  body           TEXT,
  turn           INTEGER NOT NULL,
  sandbox_bytes  INTEGER NOT NULL DEFAULT 0,
  returned_bytes INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  accessed_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session_kind_seq ON events(session_id, kind, seq);
`;
/** Verbatim column order from context-mode 2.2.0 (`src/core/journal/append.ts`). */
const INSERT_EVENT =
  "INSERT INTO events(session_id, worktree, agent, kind, tool, key, path, ok, exit_code, bytes, body, turn, sandbox_bytes, returned_bytes, created_at, accessed_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/** A Pi session id as Context Mode 2.x stores it: the raw UUID from Pi. */
const SESSION = "01a1e320-57a2-7170-9e24-97c18523d7d8";
const OTHER_SESSION = "01a1e374-102b-716a-bc21-b830112ada7b";

interface EventRow {
  sessionId?: string;
  kind?: string;
  /** `undefined` keeps the default `ctx_index`; `null` writes a row without a tool. */
  tool?: string | null;
  sandboxBytes?: number;
  returnedBytes?: number;
}

function appendEvent(db: DatabaseSync, row: EventRow = {}): void {
  const now = Date.now();
  db.prepare(INSERT_EVENT).run(
    row.sessionId ?? SESSION,
    "/work",
    "pi",
    row.kind ?? "index",
    row.tool === undefined ? "ctx_index" : row.tool,
    null,
    null,
    null,
    null,
    null,
    null,
    1,
    row.sandboxBytes ?? 0,
    row.returnedBytes ?? 0,
    now,
    now
  );
}

/** Writes a `context.db` for `cwd` the way Context Mode 2.x lays it out. */
function createProjectDatabase(cwd: string, rows: EventRow[], options: { wal?: boolean } = {}): string {
  const dbPath = contextModeDatabasePath(cwd, process.env);
  if (dbPath === undefined) throw new Error(`no database path for ${cwd}`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (options.wal !== false) db.exec("PRAGMA journal_mode = WAL");
  db.exec(EVENTS_DDL);
  for (const row of rows) appendEvent(db, row);
  db.close();
  return dbPath;
}

function keyOf(path: string): string {
  return createHash("sha256").update(realpathSync.native(path)).digest("hex").slice(0, 16);
}

function deferredReader() {
  const calls: { input: ContextModeReadInput; resolve: (value: string | undefined) => void }[] = [];
  const read: ContextModeReader = (input) => new Promise((resolve) => calls.push({ input, resolve }));
  return { read, calls };
}

async function flush() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function initRepo(directory: string): void {
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  writeFileSync(join(directory, "tracked.txt"), "committed\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: directory });
}

let root: string;
let project: string;
let originalDataDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-footer-context-mode-"));
  project = join(root, "project");
  mkdirSync(project, { recursive: true });
  originalDataDir = process.env.CONTEXT_MODE_DATA_DIR;
  process.env.CONTEXT_MODE_DATA_DIR = join(root, "data");
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.CONTEXT_MODE_DATA_DIR;
  else process.env.CONTEXT_MODE_DATA_DIR = originalDataDir;
  rmSync(root, { recursive: true, force: true });
});

describe("formatContextModeBytes", () => {
  // Expected strings produced by context-mode 2.2.0's own formatter.
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1,023 B"],
    [1024, "1.0 KB"],
    [436224, "426.0 KB"],
    [1234567, "1.2 MB"],
    [24326963, "23.2 MB"],
    [-2048, "-2.0 KB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatContextModeBytes(bytes)).toBe(expected);
  });
});

describe("contextModeProjectKey", () => {
  it("keys a repository by its Git common directory", () => {
    initRepo(project);
    const key = keyOf(join(project, ".git"));
    expect(key).toHaveLength(16);
    expect(contextModeProjectKey(project)).toBe(key);
    // Context Mode walks up, so every directory inside the worktree shares the key.
    const nested = join(project, "nested", "deeper");
    mkdirSync(nested, { recursive: true });
    expect(contextModeProjectKey(nested)).toBe(key);
  });

  it("keys a linked worktree like its main repository", () => {
    initRepo(project);
    const worktree = join(root, "linked");
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "linked", worktree], { cwd: project });
    expect(contextModeProjectKey(worktree)).toBe(keyOf(join(project, ".git")));
  });

  it("keys a directory outside Git by its real path, and gives up on a missing one", () => {
    expect(contextModeProjectKey(project)).toBe(keyOf(project));
    expect(contextModeProjectKey(join(root, "missing"))).toBeUndefined();
  });
});

describe("contextModeDatabasePath", () => {
  it("uses CONTEXT_MODE_DATA_DIR when set and ~/.context-mode otherwise", () => {
    const key = keyOf(project);
    expect(contextModeDatabasePath(project, { ...process.env, CONTEXT_MODE_DATA_DIR: "/custom" })).toBe(
      join("/custom", "projects", key, "context.db")
    );
    expect(contextModeDatabasePath(project, { HOME: "/home/test" })).toBe(join("/home/test", ".context-mode", "projects", key, "context.db"));
    expect(contextModeDatabasePath(project, { CONTEXT_MODE_DATA_DIR: "/custom" })).toBe(join("/custom", "projects", key, "context.db"));
  });

  it("has no path without a usable working directory or home", () => {
    expect(contextModeDatabasePath(join(root, "missing"), process.env)).toBeUndefined();
    expect(contextModeDatabasePath(project, { CONTEXT_MODE_DATA_DIR: "" })).toBeUndefined();
    expect(contextModeDatabasePath(project, {})).toBeUndefined();
  });
});

describe("readContextModeBytes", () => {
  it("sums this session's produced bytes, ignoring rows Context Mode does not count as calls", async () => {
    createProjectDatabase(project, [
      { sandboxBytes: 262_144, returnedBytes: 120_000 },
      { kind: "index", tool: "ctx_execute", sandboxBytes: 174_080, returnedBytes: 90_000 },
      // Never counted: cost rows, ctx_stats itself, and events without a tool.
      { kind: "cost", tool: "ctx_execute", sandboxBytes: 999_999 },
      { kind: "index", tool: "ctx_stats", sandboxBytes: 888_888 },
      { kind: "prompt", tool: null, sandboxBytes: 777_777 },
      // Another session of the same project.
      { sessionId: OTHER_SESSION, sandboxBytes: 500_000 },
    ]);

    await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBe("426.0 KB");
    await expect(readContextModeBytes({ sessionId: OTHER_SESSION, cwd: project })).resolves.toBe("488.3 KB");
  });

  it("reports the produced bytes, not the bytes that reached the chat", async () => {
    createProjectDatabase(project, [{ sandboxBytes: 436_224, returnedBytes: 1_024 }]);
    await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBe("426.0 KB");
  });

  it("stays empty for a session without calls and for a project without a database", async () => {
    createProjectDatabase(project, [{ sessionId: OTHER_SESSION, sandboxBytes: 4096 }]);
    await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBeUndefined();

    const other = join(root, "other");
    mkdirSync(other, { recursive: true });
    await expect(readContextModeBytes({ sessionId: SESSION, cwd: other })).resolves.toBeUndefined();
  });

  it("stays empty for a database it cannot open or read", async () => {
    const dbPath = createProjectDatabase(project, [{ sandboxBytes: 4096 }]);
    writeFileSync(dbPath, "not a database");
    await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBeUndefined();

    rmSync(dbPath);
    mkdirSync(dbPath);
    await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBeUndefined();
  });

  it("stays empty when the database stays locked past the timeout", async () => {
    createProjectDatabase(project, [{ sandboxBytes: 4096 }], { wal: false });
    const dbPath = contextModeDatabasePath(project, process.env) ?? "";
    const holder = new DatabaseSync(dbPath);
    holder.exec("BEGIN EXCLUSIVE");
    try {
      const started = Date.now();
      await expect(readContextModeBytes({ sessionId: SESSION, cwd: project }, 25)).resolves.toBeUndefined();
      expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  it("stays empty for a database file it may not read", async () => {
    if (process.getuid?.() === 0) return;
    const dbPath = createProjectDatabase(project, [{ sandboxBytes: 4096 }]);
    chmodSync(dbPath, 0o000);
    try {
      await expect(readContextModeBytes({ sessionId: SESSION, cwd: project })).resolves.toBeUndefined();
    } finally {
      chmodSync(dbPath, 0o600);
    }
  });
});

describe("ContextModeTracker", () => {
  it("caches the amount read for the current session and cwd", async () => {
    const { read, calls } = deferredReader();
    const onChange = vi.fn();
    const tracker = new ContextModeTracker(read, onChange);
    tracker.setSession(SESSION, project);
    tracker.refresh();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toEqual({ sessionId: SESSION, cwd: project });

    calls[0]!.resolve("426.0 KB");
    await flush();
    expect(tracker.amount).toBe("426.0 KB");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("never overlaps refreshes", async () => {
    const { read, calls } = deferredReader();
    const tracker = new ContextModeTracker(read);
    tracker.setSession(SESSION, project);
    tracker.refresh();
    tracker.refresh();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(undefined);
    await flush();
    tracker.refresh();
    expect(calls).toHaveLength(2);
  });

  it("keeps the last value through a failed refresh and clears it on session change", async () => {
    const { read, calls } = deferredReader();
    const onChange = vi.fn();
    const tracker = new ContextModeTracker(read, onChange);
    tracker.setSession(SESSION, project);
    tracker.refresh();
    calls[0]!.resolve("426.0 KB");
    await flush();

    tracker.refresh();
    calls[1]!.resolve(undefined);
    await flush();
    expect(tracker.amount).toBe("426.0 KB");

    tracker.setSession(OTHER_SESSION, project);
    expect(tracker.amount).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("clears when only the working directory changes", async () => {
    const { read, calls } = deferredReader();
    const tracker = new ContextModeTracker(read);
    tracker.setSession(SESSION, project);
    tracker.refresh();
    calls[0]!.resolve("426.0 KB");
    await flush();
    expect(tracker.amount).toBe("426.0 KB");

    tracker.setSession(SESSION, join(root, "elsewhere"));
    expect(tracker.amount).toBeUndefined();
  });

  it("does nothing without a session id or cwd and drops results for a stale session", async () => {
    const { read, calls } = deferredReader();
    const tracker = new ContextModeTracker(read);
    tracker.setSession(undefined, project);
    tracker.refresh();
    tracker.setSession(SESSION, undefined);
    tracker.refresh();
    expect(calls).toHaveLength(0);

    tracker.setSession(SESSION, project);
    tracker.refresh();
    tracker.setSession(OTHER_SESSION, project);
    calls[0]!.resolve("426.0 KB");
    await flush();
    expect(tracker.amount).toBeUndefined();
  });

  it("drops a result that arrives after only the working directory changed", async () => {
    const { read, calls } = deferredReader();
    const tracker = new ContextModeTracker(read);
    tracker.setSession(SESSION, project);
    tracker.refresh();
    tracker.setSession(SESSION, join(root, "elsewhere"));
    calls[0]!.resolve("426.0 KB");
    await flush();
    expect(tracker.amount).toBeUndefined();
  });

  it("survives a reader that rejects", async () => {
    const tracker = new ContextModeTracker(() => Promise.reject(new Error("boom")));
    tracker.setSession(SESSION, project);
    tracker.refresh();
    await flush();
    expect(tracker.amount).toBeUndefined();
  });
});
