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

interface GeminiAuthFile {
  access_token?: string;
}

interface ClaudeKeychainFile {
  claudeAiOauth?: {
    accessToken?: string;
  };
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

export function getClaudeToken(): string | undefined {
  const auth = loadAuthJson();
  const anthropic = auth.anthropic as AuthCredential | undefined;
  if (anthropic?.access) return anthropic.access as string;

  // Fallback: Claude CLI keychain (macOS)
  try {
    const keychainData = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (keychainData) {
      const parsed = JSON.parse(keychainData) as ClaudeKeychainFile;
      if (parsed.claudeAiOauth?.accessToken) {
        return parsed.claudeAiOauth.accessToken;
      }
    }
  } catch {}

  return undefined;
}

export function getCopilotToken(): string | undefined {
  const auth = loadAuthJson();
  return (auth["github-copilot"] as AuthCredential | undefined)?.refresh as string | undefined;
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

export function getGeminiToken(): string | undefined {
  const auth = loadAuthJson();
  const geminiAuth = auth["google-gemini-cli"] as AuthCredential | undefined;
  if (geminiAuth?.access) return geminiAuth.access as string;

  // Fallback: ~/.gemini/oauth_creds.json
  const geminiPath = join(homedir(), ".gemini", "oauth_creds.json");
  try {
    if (existsSync(geminiPath)) {
      const data = JSON.parse(readFileSync(geminiPath, "utf-8")) as GeminiAuthFile;
      return data.access_token;
    }
  } catch {}

  return undefined;
}

export function getMinimaxToken(provider: "minimax" | "minimax-cn"): string | undefined {
  return provider === "minimax"
    ? getApiKey("minimax", "MINIMAX_API_KEY")
    : getApiKey("minimax-cn", "MINIMAX_CN_API_KEY");
}

export function getKimiToken(): string | undefined {
  return getApiKey("kimi-coding", "KIMI_API_KEY");
}

export function getOpencodeToken(): string | undefined {
  return getApiKey("opencode-go", "OPENCODE_API_KEY");
}
