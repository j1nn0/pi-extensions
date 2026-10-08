import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageMetadata {
  name: string;
  version: string;
  keywords: string[];
  pi: { extensions: string[] };
  files: string[];
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const packageJsonUrl = new URL("../package.json", import.meta.url);

describe("package metadata", () => {
  it("declares the Pi extension, package files, and coding-agent peer dependency", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as PackageMetadata;

    expect(packageJson.name).toBe("@j1nn0/pi-exit");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.pi.extensions).toEqual(["./index.ts"]);
    expect(packageJson.files).toEqual(["index.ts", "src/", "README.md", "CHANGELOG.md", "LICENSE"]);
    expect(packageJson.keywords).toContain("pi-package");
    expect(packageJson.peerDependencies).toEqual({ "@earendil-works/pi-coding-agent": ">=1.0.0" });
  });

  it("declares the Pi development dependency set the release pipeline validates", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as PackageMetadata;

    for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
      expect(packageJson.devDependencies[name]).toBeTruthy();
    }
  });

  it("licenses the package under MIT for j1nn0 only", async () => {
    const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");

    expect(license).toContain("Copyright (c) 2026 j1nn0");
    expect(license).not.toContain("Can Celik");
    expect(license).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
  });
});
