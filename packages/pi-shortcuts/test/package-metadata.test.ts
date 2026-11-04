import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageMetadata {
  name: string;
  version: string;
  keywords: string[];
  pi: { extensions: string[] };
  files: string[];
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  publishConfig: { access: string };
  engines: { node: string };
}

const packageJsonUrl = new URL("../package.json", import.meta.url);

async function readPackageMetadata(): Promise<PackageMetadata> {
  return JSON.parse(await readFile(packageJsonUrl, "utf8")) as PackageMetadata;
}

describe("package metadata", () => {
  it("declares the Pi extension, published files, and coding-agent peer dependency", async () => {
    const packageJson = await readPackageMetadata();

    expect(packageJson.name).toBe("@j1nn0/pi-shortcuts");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(packageJson.pi.extensions).toEqual(["./index.ts"]);
    expect(packageJson.files).toEqual([
      "index.ts",
      "src/",
      "README.md",
      "README.ja.md",
      "CHANGELOG.md",
      "LICENSE",
    ]);
    expect(packageJson.keywords).toContain("pi-package");
    expect(packageJson.peerDependencies).toEqual({ "@earendil-works/pi-coding-agent": ">=1.0.0" });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.engines.node).toBe(">=22.19.0");
  });

  it("declares the development dependency set the workspace catalogs", async () => {
    const packageJson = await readPackageMetadata();

    for (const name of ["@earendil-works/pi-coding-agent", "@types/node", "typescript", "vitest"]) {
      expect(packageJson.devDependencies[name]).toBe("catalog:");
    }
  });

  it("ships every file it lists in package.json", async () => {
    const packageJson = await readPackageMetadata();

    for (const entry of packageJson.files) {
      const url = new URL(`../${entry}`, import.meta.url);
      expect((await stat(url)).isFile() || (await stat(url)).isDirectory(), entry).toBe(true);
    }
  });

  it("licenses the package under MIT for j1nn0", async () => {
    const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");

    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 j1nn0");
    expect(license).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
  });
});
