import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { getContextInfo, getThinkingLevel } from "./context.ts";
import { readFooterVisibility } from "./env.ts";
import { getGitCache, refreshGitCache } from "./git.ts";
import { renderFooterStatusLine } from "./render.ts";
import type { UsageSnapshot } from "./types.ts";
import {
  cacheUsage,
  detectProvider,
  fetchUsageForProvider,
  getCachedUsage,
  USAGE_REFRESH_INTERVAL,
} from "./usage/index.ts";

export default function (pi: ExtensionAPI): void {
  const { showCwd, showBranch, showProvider } = readFooterVisibility();

  // Track usage state for rendering
  let latestUsage: UsageSnapshot | null = null;
  let activeProvider: string | null = null; // internal provider key for the current model
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Store tui reference for triggering re-renders from event handlers
  let tuiRef: Pick<TUI, "requestRender"> | null = null;

  function refreshGitFooter(): void {
    if (refreshGitCache()) tuiRef?.requestRender();
  }

  /** Fetch usage for the active provider. Shows cached data immediately,
   *  then fetches fresh in the background. Discards results if provider
   *  changed while the fetch was in flight. */
  function fetchUsage(modelProvider: string): void {
    const provider = detectProvider(modelProvider);
    if (!provider) {
      activeProvider = null;
      latestUsage = null;
      stopRefreshTimer();
      tuiRef?.requestRender();
      return;
    }

    activeProvider = provider;

    // Show cached data immediately if available
    const cached = getCachedUsage(provider);
    if (cached && cached.windows.length > 0) {
      latestUsage = cached;
      tuiRef?.requestRender();
    }

    // Fetch fresh in background — keep cached data on transient errors
    fetchUsageForProvider(provider)
      .then((usage) => {
        if (!usage || activeProvider !== provider) return;
        if (usage.windows.length === 0 && usage.error && cached?.windows.length) return;
        cacheUsage(provider, usage);
        latestUsage = usage;
        tuiRef?.requestRender();
      })
      .catch(() => {});
  }

  /** Start (or restart) the periodic refresh timer. */
  function startRefreshTimer(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (activeProvider) {
        const provider = activeProvider;
        const cached = getCachedUsage(provider);
        fetchUsageForProvider(provider)
          .then((usage) => {
            if (!usage || activeProvider !== provider) return;
            if (usage.windows.length === 0 && usage.error && cached?.windows.length) return;
            cacheUsage(provider, usage);
            latestUsage = usage;
            tuiRef?.requestRender();
          })
          .catch(() => {});
      }
    }, USAGE_REFRESH_INTERVAL);
  }

  function stopRefreshTimer(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    refreshGitCache();

    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider): Component & {
      dispose?(): void;
    } => {
      tuiRef = tui;

      const unsub = footerData.onBranchChange(() => {
        refreshGitFooter();
      });

      // Initial fetch inside factory — tui is guaranteed available here,
      // so requestRender() will work when the async fetch completes.
      if (ctx.model?.provider) {
        fetchUsage(ctx.model.provider);
        startRefreshTimer();
      }

      return {
        dispose: () => {
          unsub();
          tuiRef = null;
          stopRefreshTimer();
        },
        invalidate() {},
        render(width: number): string[] {
          const contextInfo = getContextInfo(ctx);
          const thinkingLevel = ctx.model?.reasoning ? getThinkingLevel(ctx) : "off";

          return renderFooterStatusLine({
            width,
            cwd: ctx.cwd,
            home: process.env.HOME || process.env.USERPROFILE,
            gitCache: getGitCache(),
            showCwd,
            showBranch,
            showProvider,
            model: ctx.model,
            thinkingLevel,
            contextInfo,
            latestUsage,
            theme,
          });
        },
      };
    });
  });

  pi.on("turn_end", async () => {
    refreshGitFooter();
  });

  // Refresh when model changes — fetch immediately, restart timer
  pi.on("model_select", (event, _ctx: ExtensionContext) => {
    if (!event.model?.provider) return;
    fetchUsage(event.model.provider);
    startRefreshTimer(); // reset the 5min countdown since we just fetched
  });
}
