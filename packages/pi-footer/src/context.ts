import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextInfo } from "./types.ts";

export function getThinkingLevel(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getEntries();
  const leafId = ctx.sessionManager.getLeafId();
  const context = buildSessionContext(entries, leafId);
  return context.thinkingLevel || "off";
}

export function getContextInfo(ctx: ExtensionContext): ContextInfo {
  const model = ctx.model;
  const contextWindow = model?.contextWindow ?? 0;
  if (contextWindow === 0) return { percentage: 0, used: 0, total: 0 };

  const entries = ctx.sessionManager.getEntries();
  const leafId = ctx.sessionManager.getLeafId();
  const context = buildSessionContext(entries, leafId);
  const messages = context.messages;

  const lastAssistant = messages
    .slice()
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant" && message.stopReason !== "aborted");

  const usage = lastAssistant?.usage;
  if (!usage) return { percentage: 0, used: 0, total: contextWindow };
  const contextTokens = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);

  return { percentage: (contextTokens / contextWindow) * 100, used: contextTokens, total: contextWindow };
}
