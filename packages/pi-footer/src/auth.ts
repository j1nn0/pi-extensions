import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface AuthCredential {
  key?: unknown;
  access?: unknown;
  refresh?: unknown;
  accountId?: unknown;
}

interface CodexAuthFile {
  OPENAI_API_KEY?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CommandCodeAuthFile {
  apiKey?: unknown;
}

export function loadAuthJson(): Record<string, unknown> {
  const authPath = join(homedir(), ".pi", "agent", "auth.json");
  try {
    if (existsSync(authPath)) {
      return JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>;
    }
  } catch {}
  return {};
}

export function resolveAuthValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("!")) {
    try {
      const output = execSync(trimmed.slice(1), {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 2000,
      }).trim();
      return output || undefined;
    } catch {
      return undefined;
    }
  }

  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed) && process.env[trimmed]) {
    return process.env[trimmed];
  }

  return trimmed;
}

export function getApiKey(providerKey: string, envVar: string): string | undefined {
  if (process.env[envVar]) return process.env[envVar];

  const auth = loadAuthJson();
  const entry = auth[providerKey];
  if (!entry) return undefined;

  if (typeof entry === "string") {
    return resolveAuthValue(entry);
  }

  const credential = entry as AuthCredential;
  return resolveAuthValue(credential.key ?? credential.access ?? credential.refresh);
}

export function getCodexToken(): { token: string; accountId?: string } | undefined {
  const auth = loadAuthJson();
  const codexAuth = auth["openai-codex"] as AuthCredential | undefined;
  if (codexAuth?.access) {
    return {
      token: codexAuth.access as string,
      accountId: codexAuth.accountId as string | undefined,
    };
  }

  // Fallback: ~/.codex/auth.json
  const codexPath = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
  try {
    if (existsSync(codexPath)) {
      const data = JSON.parse(readFileSync(codexPath, "utf-8")) as CodexAuthFile;
      if (data.OPENAI_API_KEY) {
        return { token: data.OPENAI_API_KEY };
      }
      if (data.tokens?.access_token) {
        return { token: data.tokens.access_token, accountId: data.tokens.account_id };
      }
    }
  } catch {}

  return undefined;
}

export function getOpencodeToken(): string | undefined {
  return getApiKey("opencode-go", "OPENCODE_API_KEY");
}

/**
 * Resolve the Command Code API key the same way the `cmd` CLI does:
 * COMMAND_CODE_API_KEY first, then `apiKey` in ~/.commandcode/auth.json.
 */
export function getCommandCodeToken(): string | undefined {
  const fromEnv = process.env.COMMAND_CODE_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const authPath = join(homedir(), ".commandcode", "auth.json");
  try {
    if (existsSync(authPath)) {
      const data = JSON.parse(readFileSync(authPath, "utf-8")) as CommandCodeAuthFile | null;
      const apiKey = typeof data?.apiKey === "string" ? data.apiKey.trim() : "";
      if (apiKey) return apiKey;
    }
  } catch {}

  return undefined;
}
