import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Context Mode 2.x keeps one SQLite database per project. There is no statusline
 * command and no extension status channel, so the footer reads that database
 * read-only, the same way `ctx_stats` does.
 */
const DATA_DIR_ENV = "CONTEXT_MODE_DATA_DIR";
const DATA_ROOT_NAME = ".context-mode";
const PROJECTS_DIR_NAME = "projects";
const DB_FILE_NAME = "context.db";
const PROJECT_KEY_LENGTH = 16;
/** Lock wait for the read-only connection. The open blocks Pi's event loop while waiting, so keep it short; free databases answer in a few milliseconds. */
const DB_TIMEOUT_MS = 500;
const GIT_DIR_NAME = ".git";
const GIT_DIR_PREFIX = "gitdir: ";
const COMMONDIR_FILE = "commondir";
const HEAD_FILE = "HEAD";

/**
 * Context Mode 2.x counts a call as an event produced by a tool, excluding cost
 * rows and its own `ctx_stats` call (mirrors `CALLS` in `src/core/tools/stats.ts`).
 */
const CALLS = "tool IS NOT NULL AND kind <> 'cost' AND tool <> 'ctx_stats'";
const SESSION_BYTES_SQL =
  `SELECT COUNT(*) AS calls, COALESCE(SUM(sandbox_bytes), 0) AS produced ` +
  `FROM events WHERE ${CALLS} AND session_id = ?`;

/**
 * Context Mode's SQLite module, loaded on first use. Pi itself requires Node
 * >= 22.19, where `node:sqlite` is available but still prints a one-time
 * experimental warning, so a footer without Context Mode never loads it.
 */
let sqliteModule: typeof import("node:sqlite") | undefined;

function loadSqlite(): typeof import("node:sqlite") | undefined {
  sqliteModule ??= process.getBuiltinModule("node:sqlite");
  return sqliteModule;
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB"] as const;
const BYTE_COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Formats a byte count exactly like Context Mode's `ctx_stats` report does. */
export function formatContextModeBytes(bytes: number): string {
  if (bytes < 0) return `-${formatContextModeBytes(-bytes)}`;
  if (bytes < 1024) return `${BYTE_COUNT.format(Math.round(bytes))} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

function firstLine(file: string): string | null {
  try {
    const text = readFileSync(file, "utf8");
    const newline = text.indexOf("\n");
    const line = (newline < 0 ? text : text.slice(0, newline)).trim();
    return line === "" ? null : line;
  } catch {
    return null;
  }
}

/** Git directory of `dir`, following the `gitdir:` pointer file of a linked worktree. */
function gitDirAt(dotGit: string): string | null {
  try {
    let gitDir: string;
    if (statSync(dotGit).isDirectory()) {
      gitDir = dotGit;
    } else {
      const line = firstLine(dotGit);
      if (line === null || !line.startsWith(GIT_DIR_PREFIX)) return null;
      gitDir = resolve(dirname(dotGit), line.slice(GIT_DIR_PREFIX.length));
    }
    return existsSync(join(gitDir, HEAD_FILE)) ? gitDir : null;
  } catch {
    return null;
  }
}

/**
 * Git common directory of `dir`: the shared `.git` of the enclosing repository
 * (also for linked worktrees), or the real path of `dir` outside a repository.
 */
function projectRoot(dir: string): string | undefined {
  let current: string;
  try {
    current = realpathSync.native(dir);
  } catch {
    return undefined;
  }
  const start = current;
  for (;;) {
    const gitDir = gitDirAt(join(current, GIT_DIR_NAME));
    if (gitDir !== null) {
      const commonDir = firstLine(join(gitDir, COMMONDIR_FILE));
      try {
        return realpathSync.native(commonDir === null ? gitDir : resolve(gitDir, commonDir));
      } catch {
        return undefined;
      }
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

/** Context Mode's project key: the first 16 hex characters of sha256(project root). */
export function contextModeProjectKey(cwd: string): string | undefined {
  const root = projectRoot(cwd);
  if (root === undefined) return undefined;
  return createHash("sha256").update(root).digest("hex").slice(0, PROJECT_KEY_LENGTH);
}

/** Root of Context Mode's data directory: `$CONTEXT_MODE_DATA_DIR` or `~/.context-mode`. */
function dataRoot(env: NodeJS.ProcessEnv): string | undefined {
  const override = env[DATA_DIR_ENV];
  if (override) return resolve(override);
  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, DATA_ROOT_NAME) : undefined;
}

/** Absolute path of the Context Mode database for a Pi working directory. */
export function contextModeDatabasePath(cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = contextModeProjectKey(cwd);
  const root = dataRoot(env);
  if (key === undefined || root === undefined) return undefined;
  return join(root, PROJECTS_DIR_NAME, key, DB_FILE_NAME);
}

export interface ContextModeReadInput {
  /** Raw Pi session id (a UUID); Context Mode 2.x stores it verbatim. */
  sessionId: string;
  /** Pi's working directory, used to locate the project's database. */
  cwd: string;
}

/**
 * Reads one session's produced bytes from Context Mode, or undefined on any
 * failure. `timeoutMs` is the SQLite lock timeout; only tests shorten it.
 */
export async function readContextModeBytes(
  input: ContextModeReadInput,
  timeoutMs: number = DB_TIMEOUT_MS
): Promise<string | undefined> {
  const dbPath = contextModeDatabasePath(input.cwd);
  if (dbPath === undefined || !existsSync(dbPath)) return undefined;

  const sqlite = loadSqlite();
  if (sqlite === undefined) return undefined;

  let row: { calls?: unknown; produced?: unknown } | undefined;
  let db: DatabaseSync | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true, timeout: timeoutMs });
    row = db.prepare(SESSION_BYTES_SQL).get(input.sessionId) as typeof row;
  } catch {
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      // A connection that never opened has nothing to close.
    }
  }

  if (Number(row?.calls ?? 0) === 0) return undefined;
  return formatContextModeBytes(Number(row?.produced ?? 0));
}

/** Reads one session's Context Mode amount; resolves to undefined when it cannot be read. */
export type ContextModeReader = (input: ContextModeReadInput) => Promise<string | undefined>;

/**
 * Cached Context Mode amount for one Pi session. Refreshes run in the
 * background, never overlap, and keep the last value when a refresh fails.
 */
export class ContextModeTracker {
  private value: string | undefined;
  private sessionId: string | undefined;
  private cwd: string | undefined;
  private inFlight = false;
  private readonly read: ContextModeReader;
  private readonly onChange: () => void;

  constructor(read: ContextModeReader = readContextModeBytes, onChange: () => void = () => {}) {
    this.read = read;
    this.onChange = onChange;
  }

  get amount(): string | undefined {
    return this.value;
  }

  /** Point the tracker at a session; a different session or cwd drops the cached value. */
  setSession(sessionId: string | undefined, cwd: string | undefined): void {
    if (sessionId === this.sessionId && cwd === this.cwd) return;
    this.sessionId = sessionId;
    this.cwd = cwd;
    if (this.value !== undefined) {
      this.value = undefined;
      this.onChange();
    }
  }

  refresh(): void {
    const sessionId = this.sessionId;
    const cwd = this.cwd;
    if (!sessionId || !cwd || this.inFlight) return;
    this.inFlight = true;

    this.read({ sessionId, cwd })
      .then((amount) => {
        if (this.sessionId !== sessionId || this.cwd !== cwd || amount === undefined) return;
        if (amount === this.value) return;
        this.value = amount;
        this.onChange();
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
      });
  }
}
