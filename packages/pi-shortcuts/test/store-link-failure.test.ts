import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShortcut, saveShortcut } from "../src/store.ts";
import { makeShortcut } from "./fixtures.ts";

const injected = vi.hoisted(() => ({ linkErrorCode: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      const code = injected.linkErrorCode;
      if (code !== null) {
        throw Object.assign(new Error(`injected ${code} from link()`), {
          code,
          syscall: "link",
          path: String(args[1]),
        });
      }
      return actual.link(...args);
    },
  };
});

let root: string;
let agentDir: string;
let storeDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-shortcuts-link-"));
  agentDir = join(root, "agent");
  storeDir = join(agentDir, "shortcuts");
  injected.linkErrorCode = null;
});

afterEach(async () => {
  injected.linkErrorCode = null;
  await rm(root, { recursive: true, force: true });
});

describe("new-save commit when link() is unavailable", () => {
  it.each(["EPERM", "ENOTSUP"])("fails with io-error when link() reports %s", async (code) => {
    injected.linkErrorCode = code;

    const saved = await saveShortcut(makeShortcut(), { agentDir });

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("io-error");
    expect(saved.error.message).toContain(code);

    // The commit never happened: no target file and no leftover temp file.
    expect(await readdir(storeDir)).toEqual([]);
    await expect(stat(join(storeDir, "review-diff.json"))).rejects.toThrow();
  });

  it("keeps mapping a genuine EEXIST failure to already-exists", async () => {
    injected.linkErrorCode = "EEXIST";

    const saved = await saveShortcut(makeShortcut(), { agentDir });

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("already-exists");
    expect(await readdir(storeDir)).toEqual([]);
  });

  it("still saves new shortcuts when link() works and overwrites without link()", async () => {
    const created = await saveShortcut(makeShortcut({ description: "first" }), { agentDir });
    expect(created.ok).toBe(true);

    // Explicit overwrites use rename(), so a failing link() must not block them.
    injected.linkErrorCode = "EPERM";
    const replaced = await saveShortcut(makeShortcut({ description: "second" }), { agentDir, overwrite: true });
    expect(replaced.ok).toBe(true);

    expect(await readdir(storeDir)).toEqual(["review-diff.json"]);
    expect(await getShortcut("review-diff", { agentDir })).toEqual(makeShortcut({ description: "second" }));
  });
});
