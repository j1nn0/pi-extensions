import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const rootPath = new URL(root).pathname;

describe("standalone package metadata", () => {
  it("declares the Pi extension and packages all required files", async () => {
    const packageJson = JSON.parse(await readFile(join(rootPath, "package.json"), "utf8")) as {
      name: string;
      version: string;
      engines: { node: string };
      pi: { extensions: string[] };
      files: string[];
      dependencies?: Record<string, string>;
      peerDependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.name).toBe("@j1nn0/pi-footer");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.engines.node).toBe(">=22.19.0");
    expect(packageJson.pi.extensions).toEqual(["./index.ts"]);
    expect(existsSync(join(rootPath, "index.ts"))).toBe(true);
    expect(packageJson.files).toEqual(expect.arrayContaining([
      "index.ts",
      "src/",
      "assets/*.png",
      "README.md",
      "LICENSE",
    ]));
    expect(Object.keys(packageJson.dependencies ?? {}).filter((name) => name.startsWith("@earendil-works/"))).toEqual([]);
    expect(packageJson.peerDependencies["@earendil-works/pi-coding-agent"]).toBe(">=1.0.0");
    expect(packageJson.peerDependencies["@earendil-works/pi-tui"]).toBe(">=1.0.0");
    expect(packageJson.devDependencies["@earendil-works/pi-ai"]).toBe("1.0.0");
    expect(packageJson.devDependencies["@earendil-works/pi-coding-agent"]).toBe("1.0.0");
    expect(packageJson.devDependencies["@earendil-works/pi-tui"]).toBe("1.0.0");
    for (const asset of ["claude.png", "codex.png"]) {
      expect(existsSync(join(rootPath, "assets", asset))).toBe(true);
    }

    const license = await readFile(join(rootPath, "LICENSE"), "utf8");
    expect(license).toContain("Copyright (c) 2025 Can Celik\nCopyright (c) 2026 j1nn0");
    expect(license).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
  });
});
