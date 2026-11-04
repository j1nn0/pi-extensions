import { describe, expect, it } from "vitest";
import { parseShortcut, parseShortcutJson, serializeShortcut, type Shortcut } from "../src/schema.ts";
import { makeShortcut } from "./fixtures.ts";


function withField(field: string, value: unknown): Shortcut {
  return { ...makeShortcut(), [field]: value } as Shortcut;
}

describe("parseShortcut", () => {
  it("accepts a complete schemaVersion 1 record", () => {
    const record = makeShortcut();
    const result = parseShortcut(record);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shortcut).toEqual(record);
  });

  it("accepts empty params and an empty description", () => {
    const record = makeShortcut({ params: [], description: "" });
    const result = parseShortcut(record);

    expect(result.ok).toBe(true);
  });

  it("drops unknown fields and returns a fresh object", () => {
    const record = { ...makeShortcut(), futureField: "ignored" };
    const result = parseShortcut(record);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shortcut).not.toHaveProperty("futureField");
    expect(result.shortcut).not.toBe(record);
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, "shortcut", 1, true, []]) {
      const result = parseShortcut(value);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("not-an-object");
    }
  });

  it("rejects missing and unknown schema versions", () => {
    for (const schemaVersion of [undefined, null, 0, 2, "1"]) {
      const result = parseShortcut(withField("schemaVersion", schemaVersion));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("unknown-schema-version");
    }
  });

  it("rejects names that are not canonical slugs", () => {
    for (const name of ["Review Diff", "../escape", ".hidden", "", 42]) {
      const result = parseShortcut(withField("name", name));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("invalid-name");
    }
  });

  it("rejects invalid params definitions", () => {
    const cases: unknown[] = [
      "target",
      [""],
      ["two words"],
      ["a".repeat(33)],
      ["-leading"],
      [1],
      [{ name: "target", description: "A file" }],
      ["target", "TARGET"],
    ];

    for (const params of cases) {
      const result = parseShortcut(withField("params", params));
      expect(result.ok, `params=${JSON.stringify(params)}`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("invalid-field");
    }
  });

  it("rejects non-ISO timestamps", () => {
    for (const field of ["createdAt", "updatedAt"]) {
      for (const value of ["2026-01-02", "2026-01-02T03:04:05Z", "yesterday", 0]) {
        const result = parseShortcut(withField(field, value));
        expect(result.ok, `${field}=${String(value)}`).toBe(false);
        if (result.ok) continue;
        expect(result.code).toBe("invalid-field");
      }
    }
  });

  it("requires a complete source block", () => {
    const cases: unknown[] = [
      undefined,
      {},
      { sessionId: "s", range: {}, cwd: "/tmp", model: "m" },
      { sessionId: "", range: { fromEntryId: "a", toEntryId: "b" }, cwd: "/tmp", model: "m" },
      { sessionId: "s", range: { fromEntryId: "a", toEntryId: "b" }, cwd: "", model: "m" },
      { sessionId: "s", range: { fromEntryId: "a", toEntryId: "b" }, cwd: "/tmp", model: "" },
      "source",
    ];

    for (const source of cases) {
      const result = parseShortcut(withField("source", source));
      expect(result.ok, `source=${JSON.stringify(source)}`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("invalid-field");
    }
  });

  it("requires a non-empty procedure", () => {
    const result = parseShortcut(withField("procedure", ""));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-field");
  });
});

describe("parseShortcutJson", () => {
  it("rejects corrupt JSON without throwing", () => {
    const result = parseShortcutJson("{ not json");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("corrupt-json");
  });

  it("round-trips a serialized record", () => {
    const record = makeShortcut();
    const result = parseShortcutJson(serializeShortcut(record));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shortcut).toEqual(record);
  });

  it("serializes with a stable key order and trailing newline", () => {
    const text = serializeShortcut(makeShortcut());

    expect(text.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "schemaVersion",
      "name",
      "description",
      "procedure",
      "params",
      "createdAt",
      "updatedAt",
      "source",
    ]);
  });
});
