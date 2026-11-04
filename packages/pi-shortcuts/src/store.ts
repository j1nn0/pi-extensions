/**
 * File-backed shortcut store.
 *
 * Layout: `<Pi agent dir>/shortcuts/<name>.json`, where the agent dir comes from
 * Pi's public `getAgentDir()` (honours `PI_CODING_AGENT_DIR`). Every function
 * accepts an `agentDir` override so tests can point at a temporary directory.
 *
 * Guarantees (see README.md for the precise wording and limits):
 * - writes go through a same-directory temp file, an exclusive commit, fsync, and rename;
 * - an existing shortcut is never replaced unless `overwrite: true` is passed;
 * - symlinked store entries and paths that resolve outside the store are refused;
 * - files larger than 64 KiB are refused;
 * - corrupt JSON and unknown `schemaVersion` values are refused on read;
 * - listing skips unreadable files without deleting or moving them.
 */

import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeShortcutName } from "./name.ts";
import {
  parseShortcut,
  parseShortcutJson,
  serializeShortcut,
  type Shortcut,
  type ShortcutParseResult,
} from "./schema.ts";

export const SHORTCUTS_DIR_NAME = "shortcuts";
export const SHORTCUT_FILE_EXTENSION = ".json";
export const MAX_SHORTCUT_FILE_BYTES = 64 * 1024;
/** Best-effort modes; umask and platform limits can still win (documented in README). */
export const SHORTCUT_DIR_MODE = 0o700;
export const SHORTCUT_FILE_MODE = 0o600;

export type StoreErrorCode =
  | "invalid-name"
  | "invalid-record"
  | "corrupt-json"
  | "unknown-schema-version"
  | "not-found"
  | "already-exists"
  | "too-large"
  | "unsafe-path"
  | "unsupported-entry"
  | "io-error";

export interface StoreError {
  code: StoreErrorCode;
  message: string;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export interface ShortcutStoreOptions {
  /** Overrides Pi's agent dir. Defaults to `getAgentDir()`. */
  agentDir?: string;
}

export interface SaveShortcutOptions extends ShortcutStoreOptions {
  /** Replace an existing shortcut. Defaults to `false`. */
  overwrite?: boolean;
}

export interface SavedShortcut {
  name: string;
  path: string;
  created: boolean;
}

export interface SkippedShortcutFile {
  fileName: string;
  code: StoreErrorCode;
  message: string;
}

export interface ShortcutList {
  shortcuts: Shortcut[];
  skipped: SkippedShortcutFile[];
}

class StoreFailure extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreFailure";
    this.code = code;
  }
}

function fail(code: StoreErrorCode, message: string): StoreFailure {
  return new StoreFailure(code, message);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toFailure(error: unknown): StoreError {
  if (error instanceof StoreFailure) {
    return { code: error.code, message: error.message };
  }

  switch (errorCode(error)) {
    case "ENOENT":
      return { code: "not-found", message: "Shortcut not found." };
    case "EEXIST":
      return { code: "already-exists", message: "Shortcut already exists." };
    case "EACCES":
    case "EPERM":
      return { code: "io-error", message: `Permission denied: ${describeError(error)}` };
    case "ELOOP":
      return { code: "unsafe-path", message: `Refusing to follow a symlink loop: ${describeError(error)}` };
    default:
      return { code: "io-error", message: describeError(error) };
  }
}

async function guard<T>(operation: () => Promise<T>): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: toFailure(error) };
  }
}

function parseFailure(result: ShortcutParseResult & { ok: false }): StoreFailure {
  switch (result.code) {
    case "corrupt-json":
    case "unknown-schema-version":
    case "invalid-name":
      return fail(result.code, result.message);
    default:
      return fail("invalid-record", result.message);
  }
}

function requireName(raw: unknown): string {
  const result = normalizeShortcutName(raw);
  if (!result.ok) throw fail("invalid-name", result.message);
  return result.name;
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

export function resolveShortcutsDir(options: ShortcutStoreOptions = {}): string {
  return join(options.agentDir ?? getAgentDir(), SHORTCUTS_DIR_NAME);
}

async function requireStoreDir(dir: string): Promise<string> {
  const info = await lstatOrNull(dir);
  if (info === null) {
    throw fail("not-found", `No shortcut store exists at ${dir}.`);
  }
  if (info.isSymbolicLink()) {
    throw fail("unsafe-path", `Refusing to use a symlinked shortcut store: ${dir}.`);
  }
  if (!info.isDirectory()) {
    throw fail("unsupported-entry", `Shortcut store is not a directory: ${dir}.`);
  }
  return realpath(dir);
}

async function ensureStoreDir(dir: string): Promise<string> {
  if ((await lstatOrNull(dir)) === null) {
    await mkdir(dir, { recursive: true, mode: SHORTCUT_DIR_MODE });
    await chmod(dir, SHORTCUT_DIR_MODE).catch(() => {});
  }
  return requireStoreDir(dir);
}

async function writeTempFile(dir: string, bytes: Buffer): Promise<string> {
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(tempPath, "wx", SHORTCUT_FILE_MODE);
    await handle.chmod(SHORTCUT_FILE_MODE).catch(() => {});
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return tempPath;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(dir, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is unsupported on some platforms (notably Windows).
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function commitNewFile(tempPath: string, targetPath: string, name: string): Promise<void> {
  try {
    await link(tempPath, targetPath);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw fail("already-exists", `Shortcut "${name}" already exists; pass overwrite to replace it.`);
    }
    // No check-then-rename fallback: without hard links a new save must fail
    // instead of risking an unintended overwrite. See README "Limits".
    throw error;
  }
}

async function readShortcutFile(storeDir: string, fileName: string): Promise<Shortcut> {
  const expectedName = fileName.endsWith(SHORTCUT_FILE_EXTENSION)
    ? fileName.slice(0, -SHORTCUT_FILE_EXTENSION.length)
    : fileName;

  const targetPath = join(storeDir, fileName);
  const info = await lstatOrNull(targetPath);
  if (info === null) {
    throw fail("not-found", `No shortcut store entry exists at ${targetPath}.`);
  }
  if (info.isSymbolicLink()) {
    throw fail("unsafe-path", `Refusing to read a symlinked shortcut file: ${targetPath}.`);
  }
  if (!info.isFile()) {
    throw fail("unsupported-entry", `Shortcut store entry is not a regular file: ${targetPath}.`);
  }
  if (info.size > MAX_SHORTCUT_FILE_BYTES) {
    throw fail("too-large", `Shortcut file exceeds ${MAX_SHORTCUT_FILE_BYTES} bytes: ${targetPath}.`);
  }

  const resolvedTarget = await realpath(targetPath);
  if (!isInside(storeDir, resolvedTarget)) {
    throw fail("unsafe-path", `Shortcut file resolves outside the store: ${targetPath}.`);
  }

  const bytes = await readFile(resolvedTarget);
  if (bytes.byteLength > MAX_SHORTCUT_FILE_BYTES) {
    throw fail("too-large", `Shortcut file exceeds ${MAX_SHORTCUT_FILE_BYTES} bytes: ${targetPath}.`);
  }

  const record = parseShortcutJson(bytes.toString("utf8"));
  if (!record.ok) throw parseFailure(record);

  if (record.shortcut.name !== expectedName) {
    throw fail(
      "invalid-record",
      `Shortcut file ${fileName} declares name "${record.shortcut.name}"; expected "${expectedName}".`,
    );
  }

  return record.shortcut;
}

export async function saveShortcut(
  record: Shortcut,
  options: SaveShortcutOptions = {},
): Promise<StoreResult<SavedShortcut>> {
  return guard(async () => {
    const parsed = parseShortcut(record);
    if (!parsed.ok) throw parseFailure(parsed);
    const shortcut = parsed.shortcut;
    const overwrite = options.overwrite === true;

    const bytes = Buffer.from(serializeShortcut(shortcut), "utf8");
    if (bytes.byteLength > MAX_SHORTCUT_FILE_BYTES) {
      throw fail("too-large", `Shortcut "${shortcut.name}" exceeds ${MAX_SHORTCUT_FILE_BYTES} bytes.`);
    }

    const storeDir = await ensureStoreDir(resolveShortcutsDir(options));
    const targetPath = join(storeDir, `${shortcut.name}${SHORTCUT_FILE_EXTENSION}`);

    const existing = await lstatOrNull(targetPath);
    if (existing !== null) {
      if (existing.isSymbolicLink()) {
        throw fail("unsafe-path", `Refusing to write through a symlinked shortcut entry: ${targetPath}.`);
      }
      if (existing.isDirectory()) {
        throw fail("unsupported-entry", `Shortcut path is a directory: ${targetPath}.`);
      }
      if (!overwrite) {
        throw fail("already-exists", `Shortcut "${shortcut.name}" already exists; pass overwrite to replace it.`);
      }
    }

    // The store directory itself could have been swapped for a symlink since
    // `ensureStoreDir` ran; confirm the commit directory still resolves there.
    const commitDir = await realpath(dirname(targetPath));
    if (commitDir !== storeDir || !isInside(storeDir, targetPath)) {
      throw fail("unsafe-path", `Refusing to write outside the shortcut store: ${targetPath}.`);
    }

    const tempPath = await writeTempFile(storeDir, bytes);
    try {
      if (overwrite) {
        await rename(tempPath, targetPath);
      } else {
        await commitNewFile(tempPath, targetPath, shortcut.name);
      }
    } finally {
      await unlink(tempPath).catch(() => {});
    }
    await syncDirectory(storeDir);

    return { name: shortcut.name, path: targetPath, created: existing === null };
  });
}

export async function loadShortcut(
  rawName: unknown,
  options: ShortcutStoreOptions = {},
): Promise<StoreResult<Shortcut>> {
  return guard(async () => {
    const name = requireName(rawName);
    const storeDir = await requireStoreDir(resolveShortcutsDir(options));
    return readShortcutFile(storeDir, `${name}${SHORTCUT_FILE_EXTENSION}`);
  });
}

/** Convenience wrapper: `null` when the shortcut is missing, invalid, or unreadable. */
export async function getShortcut(
  rawName: unknown,
  options: ShortcutStoreOptions = {},
): Promise<Shortcut | null> {
  const result = await loadShortcut(rawName, options);
  return result.ok ? result.value : null;
}

export async function existsShortcut(
  rawName: unknown,
  options: ShortcutStoreOptions = {},
): Promise<boolean> {
  const name = normalizeShortcutName(rawName);
  if (!name.ok) return false;

  try {
    const storeDir = await requireStoreDir(resolveShortcutsDir(options));
    const info = await lstatOrNull(join(storeDir, `${name.name}${SHORTCUT_FILE_EXTENSION}`));
    return info !== null && info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function listShortcuts(options: ShortcutStoreOptions = {}): Promise<StoreResult<ShortcutList>> {
  return guard(async () => {
    const dir = resolveShortcutsDir(options);
    const info = await lstatOrNull(dir);
    if (info === null) {
      return { shortcuts: [], skipped: [] };
    }
    if (info.isSymbolicLink()) {
      throw fail("unsafe-path", `Refusing to list a symlinked shortcut store: ${dir}.`);
    }
    if (!info.isDirectory()) {
      throw fail("unsupported-entry", `Shortcut store is not a directory: ${dir}.`);
    }

    const storeDir = await realpath(dir);
    const entries = await readdir(storeDir, { withFileTypes: true });
    const shortcuts: Shortcut[] = [];
    const skipped: SkippedShortcutFile[] = [];

    for (const entry of entries) {
      if (!entry.name.endsWith(SHORTCUT_FILE_EXTENSION)) continue;

      if (entry.isSymbolicLink()) {
        skipped.push({
          fileName: entry.name,
          code: "unsafe-path",
          message: "Refusing to read a symlinked shortcut file.",
        });
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({
          fileName: entry.name,
          code: "unsupported-entry",
          message: "Shortcut store entry is not a regular file.",
        });
        continue;
      }

      try {
        shortcuts.push(await readShortcutFile(storeDir, entry.name));
      } catch (error) {
        skipped.push({ fileName: entry.name, ...toFailure(error) });
      }
    }

    shortcuts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    skipped.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));

    return { shortcuts, skipped };
  });
}
