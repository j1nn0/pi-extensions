import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsShortcut,
  getShortcut,
  listShortcuts,
  loadShortcut,
  MAX_SHORTCUT_FILE_BYTES,
  resolveShortcutsDir,
  saveShortcut,
  type StoreResult,
} from "../src/store.ts";
import { makeShortcut } from "./fixtures.ts";
import { serializeShortcut } from "../src/schema.ts";

const posixOnly = process.platform !== "win32";
const notRoot = process.getuid?.() !== 0;

let root: string;
let agentDir: string;
let storeDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-shortcuts-test-"));
  agentDir = join(root, "agent");
  storeDir = join(agentDir, "shortcuts");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function expectFailure<T>(result: StoreResult<T>, code: string): void {
  expect(result.ok, `expected ${code}, got success`).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
}

async function storeFiles(): Promise<string[]> {
  return (await readdir(storeDir)).sort();
}

async function writeRaw(fileName: string, contents: string): Promise<void> {
  await mkdir(storeDir, { recursive: true });
  await writeFile(join(storeDir, fileName), contents, "utf8");
}

describe("save and load", () => {
  it("round-trips a shortcut into the user-global store", async () => {
    const record = makeShortcut();

    const saved = await saveShortcut(record, { agentDir });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value).toEqual({
      name: "review-diff",
      path: join(await realpath(storeDir), "review-diff.json"),
      created: true,
    });
    expect(await storeFiles()).toEqual(["review-diff.json"]);

    const loaded = await loadShortcut("review-diff", { agentDir });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toEqual(record);

    const fetched = await getShortcut("review-diff", { agentDir });
    expect(fetched).toEqual(record);
  });

  it("stores one file per shortcut and lists them sorted by name", async () => {
    for (const name of ["gamma", "alpha", "beta"]) {
      expect((await saveShortcut(makeShortcut({ name }), { agentDir })).ok).toBe(true);
    }

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts.map((shortcut) => shortcut.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(listed.value.skipped).toEqual([]);
  });

  it("reports a missing store instead of creating one on read", async () => {
    expectFailure(await loadShortcut("review-diff", { agentDir }), "not-found");

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toEqual({ shortcuts: [], skipped: [] });

    expect(await existsShortcut("review-diff", { agentDir })).toBe(false);
    expect(await getShortcut("review-diff", { agentDir })).toBeNull();
    await expect(stat(storeDir)).rejects.toThrow();
  });

  it("tracks existence after a save", async () => {
    expect(await existsShortcut("review-diff", { agentDir })).toBe(false);
    await saveShortcut(makeShortcut(), { agentDir });
    expect(await existsShortcut("review-diff", { agentDir })).toBe(true);
    expect(await existsShortcut("never-saved", { agentDir })).toBe(false);
    expect(await existsShortcut("../escape", { agentDir })).toBe(false);
  });

  it("writes through the Pi agent dir env override when no agentDir is given", async () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      expect(resolveShortcutsDir()).toBe(storeDir);

      const saved = await saveShortcut(makeShortcut());
      expect(saved.ok).toBe(true);
      const loaded = await loadShortcut("review-diff");
      expect(loaded.ok).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previous;
      }
    }
  });
});

describe("validation", () => {
  it("rejects names that are not canonical slugs", async () => {
    await saveShortcut(makeShortcut(), { agentDir });

    for (const name of ["", "   ", "Review Diff", "../escape", "nested/name", ".hidden", "a".repeat(65)]) {
      const record = { ...makeShortcut(), name } as ReturnType<typeof makeShortcut>;
      expectFailure(await saveShortcut(record, { agentDir }), "invalid-name");
    }

    expect(await storeFiles()).toEqual(["review-diff.json"]);
  });

  it("rejects traversal and separator names on read without touching the filesystem", async () => {
    await saveShortcut(makeShortcut(), { agentDir });

    for (const name of ["../escape", "nested/name", "..\\escape"]) {
      expectFailure(await loadShortcut(name, { agentDir }), "invalid-name");
    }
    expect(await readdir(agentDir)).toEqual(["shortcuts"]);
  });

  it("rejects invalid params definitions", async () => {
    const cases: unknown[] = ["target", [""], ["two words"], [{ name: "target" }], ["target", "TARGET"]];

    for (const params of cases) {
      const record = { ...makeShortcut(), params } as ReturnType<typeof makeShortcut>;
      expectFailure(await saveShortcut(record, { agentDir }), "invalid-record");
    }

    expect(await existsShortcut("review-diff", { agentDir })).toBe(false);
  });

  it("rejects unknown schema versions on read", async () => {
    await writeRaw("future.json", JSON.stringify({ ...makeShortcut({ name: "future" }), schemaVersion: 2 }));

    expectFailure(await loadShortcut("future", { agentDir }), "unknown-schema-version");
    expect(await getShortcut("future", { agentDir })).toBeNull();
  });

  it("rejects a file whose declared name does not match its file name", async () => {
    await writeRaw("renamed.json", serializeShortcut(makeShortcut({ name: "other" })));

    expectFailure(await loadShortcut("renamed", { agentDir }), "invalid-record");
  });

  it("rejects a record whose fields are invalid on disk", async () => {
    const record = { ...makeShortcut(), params: [{ name: "target" }] };
    await writeRaw("review-diff.json", JSON.stringify(record));

    expectFailure(await loadShortcut("review-diff", { agentDir }), "invalid-record");
  });
});

describe("overwrite protection", () => {
  it("refuses an accidental overwrite and keeps the original bytes", async () => {
    const original = makeShortcut({ description: "first" });
    await saveShortcut(original, { agentDir });

    const second = makeShortcut({ description: "second" });
    expectFailure(await saveShortcut(second, { agentDir }), "already-exists");
    expectFailure(await saveShortcut(second, { agentDir, overwrite: false }), "already-exists");

    expect(await readFile(join(storeDir, "review-diff.json"), "utf8")).toBe(serializeShortcut(original));
    expect(await getShortcut("review-diff", { agentDir })).toEqual(original);
  });

  it("replaces an existing shortcut only with an explicit overwrite flag", async () => {
    await saveShortcut(makeShortcut({ description: "first" }), { agentDir });

    const replaced = makeShortcut({ description: "second", updatedAt: "2026-02-03T04:05:06.000Z" });
    const saved = await saveShortcut(replaced, { agentDir, overwrite: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.created).toBe(false);

    expect(await getShortcut("review-diff", { agentDir })).toEqual(replaced);
    expect(await storeFiles()).toEqual(["review-diff.json"]);
  });

  it("refuses a non-canonical spelling instead of creating a second file", async () => {
    await saveShortcut(makeShortcut({ name: "review-diff" }), { agentDir });

    // The record name must already be canonical, so a case-different request cannot
    // smuggle in a second file that resolves to the same slug.
    expectFailure(await saveShortcut(makeShortcut({ name: "Review Diff" }), { agentDir, overwrite: true }), "invalid-name");
    expect(await storeFiles()).toEqual(["review-diff.json"]);
  });

  it("lets exactly one of several concurrent creators win", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => saveShortcut(makeShortcut(), { agentDir })),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const conflicts = results.filter((result) => !result.ok);
    expect(conflicts).toHaveLength(4);
    for (const conflict of conflicts) {
      if (conflict.ok) continue;
      expect(conflict.error.code).toBe("already-exists");
    }

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts).toHaveLength(1);
    expect(await storeFiles()).toEqual(["review-diff.json"]);
  });

  it("accepts concurrent overwrites because they are explicit", async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => saveShortcut(makeShortcut(), { agentDir, overwrite: true })),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await storeFiles()).toEqual(["review-diff.json"]);
  });
});

describe("failed writes", () => {
  it("leaves no partial file when the commit target is a directory", async () => {
    await saveShortcut(makeShortcut(), { agentDir });
    await mkdir(join(storeDir, "taken.json"));

    expectFailure(await saveShortcut(makeShortcut({ name: "taken" }), { agentDir }), "unsupported-entry");
    expectFailure(await saveShortcut(makeShortcut({ name: "taken" }), { agentDir, overwrite: true }), "unsupported-entry");

    expect(await storeFiles()).toEqual(["review-diff.json", "taken.json"]);
    expect((await storeFiles()).filter((file) => file.endsWith(".tmp"))).toEqual([]);

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts.map((shortcut) => shortcut.name)).toEqual(["review-diff"]);
    expect(listed.value.skipped).toEqual([
      { fileName: "taken.json", code: "unsupported-entry", message: expect.any(String) },
    ]);
  });

  it.skipIf(!posixOnly || !notRoot)("keeps the previous file when the store becomes read-only", async () => {
    const original = makeShortcut({ description: "first" });
    await saveShortcut(original, { agentDir });

    await chmod(storeDir, 0o500);
    try {
      expectFailure(await saveShortcut(makeShortcut({ description: "second" }), { agentDir, overwrite: true }), "io-error");
    } finally {
      await chmod(storeDir, 0o700);
    }

    expect(await readFile(join(storeDir, "review-diff.json"), "utf8")).toBe(serializeShortcut(original));
    expect((await storeFiles()).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses oversized records before writing anything", async () => {
    const oversized = makeShortcut({ procedure: "x".repeat(MAX_SHORTCUT_FILE_BYTES) });

    expectFailure(await saveShortcut(oversized, { agentDir }), "too-large");
    expect(await existsShortcut("review-diff", { agentDir })).toBe(false);
    await expect(stat(storeDir)).rejects.toThrow();
  });

  it("rejects oversized files on read and skips them when listing", async () => {
    const record = makeShortcut({ name: "big" });
    const padded = `${serializeShortcut(record)}${" ".repeat(MAX_SHORTCUT_FILE_BYTES)}`;
    await writeRaw("big.json", padded);
    await saveShortcut(makeShortcut(), { agentDir });

    expectFailure(await loadShortcut("big", { agentDir }), "too-large");

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts.map((shortcut) => shortcut.name)).toEqual(["review-diff"]);
    expect(listed.value.skipped).toEqual([
      { fileName: "big.json", code: "too-large", message: expect.stringContaining("exceeds") },
    ]);
    expect(await stat(join(storeDir, "big.json"))).toBeTruthy();
  });
});

describe("read tolerance", () => {
  it("skips corrupt JSON in list without deleting or moving it", async () => {
    await saveShortcut(makeShortcut({ name: "good" }), { agentDir });
    await writeRaw("broken.json", "{ this is not json");
    await writeRaw(".abc123.tmp", "leftover temp file");

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts.map((shortcut) => shortcut.name)).toEqual(["good"]);
    expect(listed.value.skipped).toEqual([
      { fileName: "broken.json", code: "corrupt-json", message: expect.stringContaining("not valid JSON") },
    ]);
    expect(await readFile(join(storeDir, "broken.json"), "utf8")).toBe("{ this is not json");
    expect(await storeFiles()).toContain(".abc123.tmp");
  });

  it("skips a future schema version while still returning valid shortcuts", async () => {
    await saveShortcut(makeShortcut({ name: "good" }), { agentDir });
    await writeRaw("future.json", JSON.stringify({ ...makeShortcut({ name: "future" }), schemaVersion: 99 }));

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.skipped.map((entry) => entry.code)).toEqual(["unknown-schema-version"]);
    expect(await readFile(join(storeDir, "future.json"), "utf8")).toContain('"schemaVersion":99');
  });
});

describe.skipIf(!posixOnly)("symlink handling", () => {
  it("refuses to read or list a symlinked shortcut entry", async () => {
    await saveShortcut(makeShortcut(), { agentDir });
    const outside = join(root, "outside.json");
    await writeFile(outside, serializeShortcut(makeShortcut({ name: "evil" })), "utf8");
    await symlink(outside, join(storeDir, "evil.json"));

    expectFailure(await loadShortcut("evil", { agentDir }), "unsafe-path");
    expect(await getShortcut("evil", { agentDir })).toBeNull();
    expect(await existsShortcut("evil", { agentDir })).toBe(false);

    const listed = await listShortcuts({ agentDir });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.shortcuts.map((shortcut) => shortcut.name)).toEqual(["review-diff"]);
    expect(listed.value.skipped).toEqual([
      { fileName: "evil.json", code: "unsafe-path", message: expect.any(String) },
    ]);
    expect(await readFile(outside, "utf8")).toBe(serializeShortcut(makeShortcut({ name: "evil" })));
  });

  it("refuses to write through a symlinked shortcut entry", async () => {
    await saveShortcut(makeShortcut(), { agentDir });
    const outside = join(root, "outside.json");
    await writeFile(outside, "do not touch\n", "utf8");
    await rm(join(storeDir, "review-diff.json"));
    await symlink(outside, join(storeDir, "review-diff.json"));

    expectFailure(await saveShortcut(makeShortcut(), { agentDir }), "unsafe-path");
    expectFailure(await saveShortcut(makeShortcut(), { agentDir, overwrite: true }), "unsafe-path");
    expect(await readFile(outside, "utf8")).toBe("do not touch\n");
  });

  it("refuses a symlinked store directory", async () => {
    const outsideDir = join(root, "outside-store");
    await mkdir(outsideDir);
    await mkdir(agentDir, { recursive: true });
    await symlink(outsideDir, storeDir);

    expectFailure(await saveShortcut(makeShortcut(), { agentDir }), "unsafe-path");
    expectFailure(await loadShortcut("review-diff", { agentDir }), "unsafe-path");

    const listed = await listShortcuts({ agentDir });
    expectFailure(listed, "unsafe-path");
    expect(await readdir(outsideDir)).toEqual([]);
  });
});

describe.skipIf(!posixOnly)("permissions", () => {
  it("uses restrictive modes even with a permissive umask", async () => {
    const previousUmask = process.umask(0);
    try {
      const saved = await saveShortcut(makeShortcut(), { agentDir });
      expect(saved.ok).toBe(true);

      expect((await stat(storeDir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(storeDir, "review-diff.json"))).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("does not loosen the mode of an existing store directory", async () => {
    await mkdir(storeDir, { recursive: true, mode: 0o755 });
    await chmod(storeDir, 0o755);

    await saveShortcut(makeShortcut(), { agentDir });

    expect((await stat(storeDir)).mode & 0o777).toBe(0o755);
    expect((await stat(join(storeDir, "review-diff.json"))).mode & 0o777).toBe(0o600);
  });
});
