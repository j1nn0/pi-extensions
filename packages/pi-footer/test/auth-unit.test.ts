import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApiKey, getCommandCodeToken } from "../src/auth.ts";

const ENV_KEYS = ["HOME", "FOOTER_TEST_API_KEY", "FOOTER_AUTH_REFERENCE", "COMMAND_CODE_API_KEY"] as const;
let originalEnv = new Map<string, string | undefined>();
let home = "";
let authPath = "";

async function writeAuth(auth: unknown): Promise<void> {
  await writeFile(authPath, JSON.stringify(auth));
}

beforeEach(async () => {
  originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  home = await mkdtemp(join(tmpdir(), "pi-footer-auth-test-"));
  authPath = join(home, ".pi", "agent", "auth.json");
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeAuth({});
  process.env.HOME = home;
  delete process.env.FOOTER_TEST_API_KEY;
  delete process.env.FOOTER_AUTH_REFERENCE;
  delete process.env.COMMAND_CODE_API_KEY;
});

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (home) await rm(home, { recursive: true, force: true });
});

describe("getApiKey", () => {
  it("prefers the environment variable over auth.json", async () => {
    await writeAuth({ provider: { key: "file-token" } });
    process.env.FOOTER_TEST_API_KEY = "environment-token";

    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("environment-token");
  });

  it("resolves a string entry and object key/access/refresh values", async () => {
    await writeAuth({ provider: "  string-token  " });
    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("string-token");

    await writeAuth({ provider: { key: "key-token", access: "access-token", refresh: "refresh-token" } });
    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("key-token");

    await writeAuth({ provider: { access: "access-token", refresh: "refresh-token" } });
    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("access-token");

    await writeAuth({ provider: { refresh: "refresh-token" } });
    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("refresh-token");
  });

  it("resolves ENV_NAME indirection from auth.json", async () => {
    await writeAuth({ provider: "FOOTER_AUTH_REFERENCE" });
    process.env.FOOTER_AUTH_REFERENCE = "indirected-token";

    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("indirected-token");
  });

  it("executes only the explicitly provided harmless !echo command", async () => {
    await writeAuth({ provider: "!echo test-token" });

    expect(getApiKey("provider", "FOOTER_TEST_API_KEY")).toBe("test-token");
  });
});

describe("getCommandCodeToken", () => {
  async function writeCommandCodeAuth(content: string): Promise<void> {
    await mkdir(join(home, ".commandcode"), { recursive: true });
    await writeFile(join(home, ".commandcode", "auth.json"), content);
  }

  it("prefers a trimmed COMMAND_CODE_API_KEY over the CLI auth file", async () => {
    await writeCommandCodeAuth(JSON.stringify({ apiKey: "file-token" }));
    process.env.COMMAND_CODE_API_KEY = "  env-token  ";
    expect(getCommandCodeToken()).toBe("env-token");
  });

  it("ignores a blank environment variable and reads apiKey from ~/.commandcode/auth.json", async () => {
    await writeCommandCodeAuth(JSON.stringify({ apiKey: " file-token ", userName: "someone" }));
    process.env.COMMAND_CODE_API_KEY = "   ";
    expect(getCommandCodeToken()).toBe("file-token");
  });

  it("returns undefined for a missing, malformed, or keyless auth file", async () => {
    expect(getCommandCodeToken()).toBeUndefined();
    await writeCommandCodeAuth("{not json");
    expect(getCommandCodeToken()).toBeUndefined();
    await writeCommandCodeAuth(JSON.stringify({ apiKey: 42 }));
    expect(getCommandCodeToken()).toBeUndefined();
    await writeCommandCodeAuth("null");
    expect(getCommandCodeToken()).toBeUndefined();
  });
});
