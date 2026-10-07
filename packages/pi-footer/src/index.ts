import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { ContextModeTracker } from "./context-mode.ts";
import { readFooterVisibility } from "./env.ts";
import { getGitCache, refreshGitCache } from "./git.ts";
import { renderFooter } from "./render.ts";
import { createCacheUsageReader, getSessionStartTime } from "./session.ts";
import type { UsageSnapshot } from "./types.ts";
import {
  cacheUsage,
  detectProvider,
  fetchUsageForProvider,
  getCachedUsage,
  type ProviderModel,
  USAGE_REFRESH_INTERVAL,
} from "./usage/index.ts";

// The footer shows minute-level session duration; re-render once a minute.
const CLOCK_INTERVAL = 60_000;

function shortenHome(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export default function (pi: ExtensionAPI): void {
  const { showCwd, showBranch, showProvider, showContextMode } = readFooterVisibility();

  // Track usage state for rendering
  let latestUsage: UsageSnapshot | null = null;
  let activeProvider: string | null = null; // internal provider key for the current model
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  // Store tui reference for triggering re-renders from event handlers
  let tuiRef: Pick<TUI, "requestRender"> | null = null;

  const contextMode = new ContextModeTracker(undefined, () => tuiRef?.requestRender());

  function refreshGitFooter(): void {
    if (refreshGitCache()) tuiRef?.requestRender();
  }

  function refreshContextMode(): void {
    if (showContextMode) contextMode.refresh();
  }

  /** Fetch fresh usage in the background. Keeps cached data on transient
   *  errors and discards results if the provider changed in flight. */
  function refreshUsage(provider: string): void {
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

  /** Switch quota tracking to the model's provider. Shows only that provider's
   *  cached data (or nothing), fetches fresh data, and runs the refresh timer
   *  only while a supported provider is active. */
  function selectUsageProvider(model: ProviderModel): void {
    const provider = detectProvider(model);
    if (!provider) {
      activeProvider = null;
      latestUsage = null;
      stopRefreshTimer();
      tuiRef?.requestRender();
      return;
    }

    activeProvider = provider;

    // Never keep showing another provider's quota while this one loads.
    const cached = getCachedUsage(provider);
    latestUsage = cached && cached.windows.length > 0 ? cached : null;
    tuiRef?.requestRender();

    refreshUsage(provider);
    startRefreshTimer(); // restart the 5min countdown since we just fetched
  }

  /** Start (or restart) the periodic refresh timer. */
  function startRefreshTimer(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (activeProvider) refreshUsage(activeProvider);
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
      const readCacheUsage = createCacheUsageReader();

      const unsub = footerData.onBranchChange(() => {
        refreshGitFooter();
      });

      // Initial fetch inside factory — tui is guaranteed available here,
      // so requestRender() will work when the async fetch completes.
      if (ctx.model?.provider) selectUsageProvider(ctx.model);

      contextMode.setSession(ctx.sessionManager.getSessionFile());
      refreshContextMode();

      if (clockTimer) clearInterval(clockTimer);
      clockTimer = setInterval(() => tuiRef?.requestRender(), CLOCK_INTERVAL);

      return {
        dispose: () => {
          unsub();
          tuiRef = null;
          stopRefreshTimer();
          if (clockTimer) {
            clearInterval(clockTimer);
            clockTimer = null;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          const startedAt = getSessionStartTime(ctx.sessionManager);

          return renderFooter({
            width,
            theme,
            model: ctx.model,
            showProvider,
            thinkingLevel: ctx.thinkingLevel,
            context: ctx.getContextUsage(),
            cache: readCacheUsage(ctx.sessionManager),
            usage: latestUsage,
            durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
            cwd: showCwd ? shortenHome(ctx.cwd) : undefined,
            git: showBranch ? getGitCache() : null,
            contextMode: showContextMode ? contextMode.amount : undefined,
          });
        },
      };
    });
  });

  pi.on("turn_end", async () => {
    refreshGitFooter();
    refreshContextMode();
  });

  // Refresh when model changes — fetch immediately, restart timer
  pi.on("model_select", (event, _ctx: ExtensionContext) => {
    if (!event.model?.provider) return;
    selectUsageProvider(event.model);
  });
}
