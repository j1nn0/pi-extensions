import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
type ReadSource = "visible" | "recent" | "recent-unwrapped";

interface WorkspaceInfo {
	workspace_id: string;
	number: number;
	label: string;
	focused: boolean;
	pane_count: number;
	tab_count: number;
	active_tab_id: string;
	agent_status: AgentStatus;
}

interface TabInfo {
	tab_id: string;
	workspace_id: string;
	number: number;
	label: string;
	focused: boolean;
	pane_count: number;
	agent_status: AgentStatus;
}

interface PaneInfo {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
	focused: boolean;
	cwd?: string;
	agent?: string;
	agent_status: AgentStatus;
	revision: number;
}

interface PaneReadResult {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
	source: "visible" | "recent" | "recent_unwrapped";
	text: string;
	revision: number;
	truncated: boolean;
}

interface ManagedPane {
	paneId: string;
	workspaceId: string;
}

interface HerdrJsonEnvelope {
	id?: string;
	result?: any;
	error?: {
		code?: string;
		message?: string;
	};
}

interface HerdrToolDetails {
	action?: string;
	aliases: Record<string, ManagedPane>;
	aliasOrder: string[];
	[key: string]: unknown;
}

const ActionEnum = StringEnum(
	[
		"list",
		"workspace_list",
		"workspace_create",
		"workspace_focus",
		"tab_list",
		"tab_create",
		"tab_focus",
		"focus",
		"run",
		"read",
		"watch",
		"wait_agent",
		"send",
		"stop",
	] as const,
	{ description: "Action to perform" },
);

const StatusEnum = StringEnum(["idle", "working", "blocked", "done", "unknown"] as const, {
	description: "Agent status to wait for",
});

const SourceEnum = StringEnum(["visible", "recent", "recent-unwrapped"] as const, {
	description: "Read source for read/watch",
});

const DirectionEnum = StringEnum(["right", "down"] as const, {
	description: "Split direction for run",
});

export default function (pi: ExtensionAPI) {
	const herdrEnv = process.env.HERDR_ENV;
	const currentPaneTargetEnv = process.env.HERDR_PANE_ID;
	if (!herdrEnv || !currentPaneTargetEnv) {
		return;
	}
	const currentPaneTarget = currentPaneTargetEnv;

	const managedPanes = new Map<string, ManagedPane>();
	const aliasOrder: string[] = [];

	function snapshotAliases(): Record<string, ManagedPane> {
		return Object.fromEntries(managedPanes.entries());
	}

	function withSnapshot(details: Omit<HerdrToolDetails, "aliases" | "aliasOrder">): HerdrToolDetails {
		return {
			...details,
			aliases: snapshotAliases(),
			aliasOrder: [...aliasOrder],
		};
	}

	function setAliases(aliases: Record<string, ManagedPane>, order: string[]) {
		managedPanes.clear();
		aliasOrder.length = 0;
		for (const [alias, managed] of Object.entries(aliases)) {
			managedPanes.set(alias, managed);
		}
		for (const alias of order) {
			if (managedPanes.has(alias)) aliasOrder.push(alias);
		}
		for (const alias of managedPanes.keys()) {
			if (!aliasOrder.includes(alias)) aliasOrder.push(alias);
		}
	}

	function reconstructState(ctx: ExtensionContext) {
		let aliases: Record<string, ManagedPane> = {};
		let order: string[] = [];

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "toolResult" || message.toolName !== "herdr") continue;
			const details = message.details as HerdrToolDetails | undefined;
			if (!details?.aliases) continue;
			aliases = details.aliases;
			order = Array.isArray(details.aliasOrder) ? details.aliasOrder : Object.keys(details.aliases);
		}

		setAliases(aliases, order);
	}

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	function recordAlias(alias: string, paneId: string, workspaceId: string) {
		managedPanes.set(alias, { paneId, workspaceId });
		const existingIndex = aliasOrder.indexOf(alias);
		if (existingIndex !== -1) aliasOrder.splice(existingIndex, 1);
		aliasOrder.push(alias);
	}

	function forgetAlias(alias: string) {
		managedPanes.delete(alias);
		const index = aliasOrder.indexOf(alias);
		if (index !== -1) aliasOrder.splice(index, 1);
	}

	function parseHerdrError(output: string): string | null {
		const trimmed = output.trim();
		if (!trimmed) return null;
		try {
			const value = JSON.parse(trimmed) as HerdrJsonEnvelope;
			return value.error?.message || value.error?.code || trimmed;
		} catch {
			return trimmed;
		}
	}

	async function execHerdr(args: string[]) {
		const result = await pi.exec("herdr", args);
		if (result.code !== 0) {
			const message =
				parseHerdrError(result.stderr) ||
				parseHerdrError(result.stdout) ||
				`herdr ${args.join(" ")} failed with exit code ${result.code}`;
			throw new Error(message);
		}
		return result;
	}

	async function execHerdrJson<T = any>(args: string[]): Promise<T> {
		const result = await execHerdr(args);
		const stdout = result.stdout.trim();
		if (!stdout) {
			throw new Error(`Expected JSON output from herdr ${args.join(" ")}`);
		}
		let value: HerdrJsonEnvelope;
		try {
			value = JSON.parse(stdout) as HerdrJsonEnvelope;
		} catch {
			throw new Error(`Failed to parse JSON from herdr ${args.join(" ")}`);
		}
		if (value.error) {
			throw new Error(value.error.message || value.error.code || `herdr ${args.join(" ")} failed`);
		}
		return value as T;
	}

	async function execHerdrText(args: string[]): Promise<string> {
		const result = await execHerdr(args);
		return result.stdout;
	}

	async function getCurrentPaneInfo(): Promise<PaneInfo> {
		const response = await execHerdrJson<{ result: { pane: PaneInfo } }>(["pane", "get", currentPaneTarget]);
		return response.result.pane;
	}

	async function getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
		const response = await execHerdrJson<{ result: { workspace: WorkspaceInfo } }>([
			"workspace",
			"get",
			workspaceId,
		]);
		return response.result.workspace;
	}

	async function getWorkspaceList(): Promise<WorkspaceInfo[]> {
		const response = await execHerdrJson<{ result: { workspaces: WorkspaceInfo[] } }>(["workspace", "list"]);
		return response.result.workspaces || [];
	}

	async function getWorkspacePanes(workspaceId: string): Promise<PaneInfo[]> {
		const response = await execHerdrJson<{ result: { panes: PaneInfo[] } }>([
			"pane",
			"list",
			"--workspace",
			workspaceId,
		]);
		return response.result.panes || [];
	}

	async function getTabList(workspaceId?: string): Promise<TabInfo[]> {
		const args = ["tab", "list"];
		if (workspaceId) args.push("--workspace", workspaceId);
		const response = await execHerdrJson<{ result: { tabs: TabInfo[] } }>(args);
		return response.result.tabs || [];
	}

	async function getPaneInfo(paneId: string): Promise<PaneInfo | null> {
		try {
			const response = await execHerdrJson<{ result: { pane: PaneInfo } }>(["pane", "get", paneId]);
			return response.result.pane;
		} catch {
			return null;
		}
	}

	async function resolveManagedPane(alias: string, workspaceId: string): Promise<ManagedPane | null> {
		const managed = managedPanes.get(alias);
		if (!managed) return null;
		if (managed.workspaceId !== workspaceId) return null;

		const pane = await getPaneInfo(managed.paneId);
		if (!pane) {
			forgetAlias(alias);
			return null;
		}

		return managed;
	}

	async function resolvePaneRef(ref: string, workspaceId: string): Promise<{ pane: PaneInfo; alias?: string } | null> {
		const managed = await resolveManagedPane(ref, workspaceId);
		if (managed) {
			const pane = await getPaneInfo(managed.paneId);
			if (!pane) {
				forgetAlias(ref);
				return null;
			}
			return { pane, alias: ref };
		}

		const pane = await getPaneInfo(ref);
		if (!pane) return null;
		const alias = [...managedPanes.entries()].find(([, managedPane]) => managedPane.paneId === pane.pane_id)?.[0];
		return { pane, alias };
	}

	async function findSplitTarget(currentPaneId: string, workspaceId: string): Promise<{ target: string; direction: "right" | "down" }> {
		for (const alias of [...aliasOrder].reverse()) {
			const managed = await resolveManagedPane(alias, workspaceId);
			if (managed) {
				return { target: managed.paneId, direction: "down" };
			}
		}
		return { target: currentPaneId, direction: "right" };
	}

	async function readPane(
		paneId: string,
		options: { source?: ReadSource; lines?: number; raw?: boolean },
	): Promise<string> {
		const args = ["pane", "read", paneId];
		if (options.source) args.push("--source", options.source);
		if (options.lines != null) args.push("--lines", String(options.lines));
		if (options.raw) args.push("--raw");
		return execHerdrText(args);
	}

	function formatReadOutput(output: string): string {
		const truncation = truncateTail(output, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});

		let text = truncation.content;
		if (truncation.truncated) {
			text = `[Showing last ${truncation.outputLines} of ${truncation.totalLines} lines]\n${text}`;
		}
		return text;
	}

	function summarizePane(pane: PaneInfo, alias?: string, currentPaneId?: string): string {
		const name = alias || pane.pane_id;
		const flags = [
			pane.pane_id === currentPaneId || pane.focused ? "current" : null,
			pane.agent ? pane.agent : null,
			pane.agent_status !== "unknown" ? pane.agent_status : null,
		]
			.filter(Boolean)
			.join(", ");
		const cwd = pane.cwd ? ` ${pane.cwd}` : "";
		return `${name}: [${pane.pane_id}]${flags ? ` (${flags})` : ""}${cwd}`;
	}

	function summarizeTab(tab: TabInfo): string {
		const flags = [tab.focused ? "focused" : null, tab.agent_status !== "unknown" ? tab.agent_status : null]
			.filter(Boolean)
			.join(", ");
		return `${tab.label}: [${tab.tab_id}]${flags ? ` (${flags})` : ""}`;
	}

	function summarizeWorkspace(workspace: WorkspaceInfo): string {
		const flags = [workspace.focused ? "focused" : null, workspace.agent_status !== "unknown" ? workspace.agent_status : null]
			.filter(Boolean)
			.join(", ");
		return `${workspace.label}: [${workspace.workspace_id}]${flags ? ` (${flags})` : ""}`;
	}

	function statusDot(theme: any, status: AgentStatus): string {
		switch (status) {
			case "blocked":
				return theme.fg("warning", "●");
			case "working":
				return theme.fg("accent", "●");
			case "done":
				return theme.fg("success", "●");
			case "idle":
				return theme.fg("muted", "○");
			default:
				return theme.fg("dim", "·");
		}
	}

	pi.registerTool({
		name: "herdr",
		label: "herdr",
		description:
			"Herdr-native pane orchestration for long-running workflows. " +
			"Actions: list panes, manage workspaces and tabs, run commands in sibling panes, read output, watch readiness, wait for agent status, send text or keys, focus contexts, and stop panes.",
		promptGuidelines: [
			"Use `herdr` run for long-running processes in sibling panes instead of `bash`.",
			"Use `herdr` workspace and tab actions to organize parallel work instead of piling everything into one pane stack.",
			"Use `herdr` watch for log/output conditions like server readiness, test completion, or regex matches.",
			"Use `herdr` wait_agent with agent statuses. Background finished panes usually become `done`; focused finished panes usually become `idle`.",
			"Use `recent-unwrapped` when you need log matching or reads that ignore soft wrapping.",
			"Pane references can be either friendly aliases you created earlier or real herdr pane ids from `list`.",
			"Use friendly pane aliases like `server`, `reviewer`, or `tests` so later reads, watches, and sends can reuse them across the session.",
			"When starting a fresh pi instance in another pane and the model matters, either specify `--model` explicitly or ask the user which model/provider they want.",
		],
		parameters: Type.Object({
			action: ActionEnum,
			pane: Type.Optional(Type.String({ description: "Friendly pane alias or explicit pane id" })),
			workspace: Type.Optional(Type.String({ description: "Workspace id for workspace or tab actions" })),
			tab: Type.Optional(Type.String({ description: "Tab id for tab or focus actions" })),
			command: Type.Optional(Type.String({ description: "Shell command to run (for run action)" })),
			match: Type.Optional(Type.String({ description: "Text or regex to wait for (for watch action)" })),
			regex: Type.Optional(Type.Boolean({ description: "Treat match as a regex (for watch action)" })),
			status: Type.Optional(StatusEnum),
			timeout: Type.Optional(Type.Number({ description: "Timeout in ms (for watch or wait_agent action)" })),
			lines: Type.Optional(Type.Number({ description: "Scrollback lines to capture or inspect" })),
			source: Type.Optional(SourceEnum),
			raw: Type.Optional(Type.Boolean({ description: "Disable ANSI stripping for read/watch" })),
			text: Type.Optional(Type.String({ description: "Literal text to send (for send action)" })),
			keys: Type.Optional(
				Type.String({
					description: "Keys to send, space-separated (for send action). Examples: C-c, Enter, q, y",
				}),
			),
			restart: Type.Optional(
				Type.Boolean({ description: "Close and recreate the alias pane before running (for run action)" }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory for the new pane or workspace/tab (where supported)" })),
			direction: Type.Optional(DirectionEnum),
			focus: Type.Optional(Type.Boolean({ description: "Focus the newly created workspace or tab, or the new run pane" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const currentPane = await getCurrentPaneInfo();
			const currentPaneId = currentPane.pane_id;
			const currentWorkspaceId = currentPane.workspace_id;

			switch (params.action) {
				case "list": {
					const panes = await getWorkspacePanes(currentWorkspaceId);
					const aliasByPaneId = new Map<string, string>();
					for (const [alias, managed] of managedPanes.entries()) {
						if (managed.workspaceId === currentWorkspaceId) aliasByPaneId.set(managed.paneId, alias);
					}

					const text = panes.length
						? panes.map((pane) => summarizePane(pane, aliasByPaneId.get(pane.pane_id), currentPaneId)).join("\n")
						: "No panes in current workspace.";

					return {
						content: [{ type: "text", text }],
						details: withSnapshot({
							action: "list",
							panes,
							currentPaneId,
							workspaceId: currentWorkspaceId,
							paneAliases: Object.fromEntries(aliasByPaneId),
						}),
					};
				}

				case "workspace_list": {
					const workspaces = await getWorkspaceList();
					const text = workspaces.length
						? workspaces.map(summarizeWorkspace).join("\n")
						: "No workspaces.";
					return {
						content: [{ type: "text", text }],
						details: withSnapshot({ action: "workspace_list", workspaces }),
					};
				}

				case "workspace_create": {
					const args = ["workspace", "create"];
					if (params.cwd) args.push("--cwd", params.cwd);
					if (params.focus === false) args.push("--no-focus");
					const response = await execHerdrJson<{ result: { workspace: WorkspaceInfo } }>(args);
					const workspace = response.result.workspace;
					const panes = await getWorkspacePanes(workspace.workspace_id);
					const rootPane = panes[0] || null;
					if (params.pane && rootPane) {
						recordAlias(params.pane, rootPane.pane_id, workspace.workspace_id);
					}
					return {
						content: [{ type: "text", text: `Created workspace '${workspace.label}' (${workspace.workspace_id})` }],
						details: withSnapshot({
							action: "workspace_create",
							workspace,
							rootPaneId: rootPane?.pane_id,
							pane: params.pane,
						}),
					};
				}

				case "workspace_focus": {
					const workspaceId = params.workspace;
					if (!workspaceId) throw new Error("'workspace' is required for workspace_focus");
					const response = await execHerdrJson<{ result: { workspace: WorkspaceInfo } }>([
						"workspace",
						"focus",
						workspaceId,
					]);
					return {
						content: [{ type: "text", text: `Focused workspace '${response.result.workspace.label}'` }],
						details: withSnapshot({ action: "workspace_focus", workspace: response.result.workspace }),
					};
				}

				case "tab_list": {
					const workspaceId = params.workspace ?? currentWorkspaceId;
					const tabs = await getTabList(workspaceId);
					const text = tabs.length ? tabs.map(summarizeTab).join("\n") : "No tabs.";
					return {
						content: [{ type: "text", text }],
						details: withSnapshot({ action: "tab_list", tabs, workspaceId }),
					};
				}

				case "tab_create": {
					const workspaceId = params.workspace ?? currentWorkspaceId;
					const args = ["tab", "create", "--workspace", workspaceId];
					if (params.cwd) args.push("--cwd", params.cwd);
					if (params.focus === false) args.push("--no-focus");
					const response = await execHerdrJson<{ result: { tab: TabInfo } }>(args);
					const tab = response.result.tab;
					const panes = await getWorkspacePanes(tab.workspace_id);
					const rootPane = panes.find((pane) => pane.tab_id === tab.tab_id) || null;
					if (params.pane && rootPane) {
						recordAlias(params.pane, rootPane.pane_id, tab.workspace_id);
					}
					return {
						content: [{ type: "text", text: `Created tab '${tab.label}' (${tab.tab_id})` }],
						details: withSnapshot({
							action: "tab_create",
							tab,
							rootPaneId: rootPane?.pane_id,
							pane: params.pane,
						}),
					};
				}

				case "tab_focus": {
					const tabId = params.tab;
					if (!tabId) throw new Error("'tab' is required for tab_focus");
					const response = await execHerdrJson<{ result: { tab: TabInfo } }>(["tab", "focus", tabId]);
					return {
						content: [{ type: "text", text: `Focused tab '${response.result.tab.label}'` }],
						details: withSnapshot({ action: "tab_focus", tab: response.result.tab }),
					};
				}

				case "focus": {
					if (params.tab) {
						const response = await execHerdrJson<{ result: { tab: TabInfo } }>(["tab", "focus", params.tab]);
						return {
							content: [{ type: "text", text: `Focused tab '${response.result.tab.label}'` }],
							details: withSnapshot({ action: "focus", target: "tab", tab: response.result.tab }),
						};
					}
					if (params.workspace) {
						const response = await execHerdrJson<{ result: { workspace: WorkspaceInfo } }>([
							"workspace",
							"focus",
							params.workspace,
						]);
						return {
							content: [{ type: "text", text: `Focused workspace '${response.result.workspace.label}'` }],
							details: withSnapshot({ action: "focus", target: "workspace", workspace: response.result.workspace }),
						};
					}
					if (params.pane) {
						const resolved = await resolvePaneRef(params.pane, currentWorkspaceId);
						if (!resolved) throw new Error(`Pane '${params.pane}' not found in the current workspace.`);
						const response = await execHerdrJson<{ result: { tab: TabInfo } }>(["tab", "focus", resolved.pane.tab_id]);
						return {
							content: [{
								type: "text",
								text: `Focused tab '${response.result.tab.label}' for pane '${resolved.pane.pane_id}'. Herdr does not expose direct pane focus yet.`,
							}],
							details: withSnapshot({ action: "focus", target: "pane", paneId: resolved.pane.pane_id, tab: response.result.tab }),
						};
					}
					throw new Error("'workspace', 'tab', or 'pane' is required for focus");
				}

				case "run": {
					const alias = params.pane;
					const command = params.command;
					if (!alias) throw new Error("'pane' is required for run and acts as the managed alias");
					if (!command) throw new Error("'command' is required for run");

					const existing = await resolveManagedPane(alias, currentWorkspaceId);
					if (existing && !params.restart) {
						throw new Error(
							`Pane alias '${alias}' already exists (${existing.paneId}). Use restart: true to recreate it.`,
						);
					}
					if (existing) {
						await execHerdr(["pane", "close", existing.paneId]);
						forgetAlias(alias);
					}

					const autoTarget = await findSplitTarget(currentPaneId, currentWorkspaceId);
					const splitTarget = params.direction ? currentPaneId : autoTarget.target;
					const splitDirection = params.direction || autoTarget.direction;
					const splitArgs = ["pane", "split", splitTarget, "--direction", splitDirection];
					if (params.focus !== true) splitArgs.push("--no-focus");
					if (params.cwd) splitArgs.push("--cwd", params.cwd);

					const split = await execHerdrJson<{ result: { pane: PaneInfo } }>(splitArgs);
					const newPane = split.result.pane;
					await execHerdr(["pane", "run", newPane.pane_id, command]);
					recordAlias(alias, newPane.pane_id, currentWorkspaceId);

					await new Promise((resolve) => setTimeout(resolve, 800));
					const initialOutput = await readPane(newPane.pane_id, {
						source: params.source ?? "recent",
						lines: params.lines ?? 20,
						raw: params.raw,
					});

					return {
						content: [
							{
								type: "text",
								text: `Started '${command}' in pane '${alias}' (${newPane.pane_id})\n\n${formatReadOutput(initialOutput)}`,
							},
						],
						details: withSnapshot({
							action: "run",
							pane: alias,
							paneId: newPane.pane_id,
							command,
							direction: splitDirection,
							workspaceId: currentWorkspaceId,
						}),
					};
				}

				case "read": {
					const paneRef = params.pane;
					if (!paneRef) throw new Error("'pane' is required for read");

					const resolved = await resolvePaneRef(paneRef, currentWorkspaceId);
					if (!resolved) throw new Error(`Pane '${paneRef}' not found in the current workspace.`);

					const output = await readPane(resolved.pane.pane_id, {
						source: params.source ?? "recent",
						lines: params.lines ?? 20,
						raw: params.raw,
					});

					return {
						content: [{ type: "text", text: formatReadOutput(output) }],
						details: withSnapshot({
							action: "read",
							pane: resolved.alias || paneRef,
							paneId: resolved.pane.pane_id,
							source: params.source ?? "recent",
						}),
					};
				}

				case "watch": {
					const paneRef = params.pane;
					const match = params.match;
					if (!paneRef) throw new Error("'pane' is required for watch");
					if (!match) throw new Error("'match' is required for watch");

					const resolved = await resolvePaneRef(paneRef, currentWorkspaceId);
					if (!resolved) throw new Error(`Pane '${paneRef}' not found in the current workspace.`);

					const args = ["wait", "output", resolved.pane.pane_id, "--match", match];
					if (params.source) args.push("--source", params.source);
					if (params.lines != null) args.push("--lines", String(params.lines));
					if (params.timeout != null) args.push("--timeout", String(params.timeout));
					if (params.regex) args.push("--regex");
					if (params.raw) args.push("--raw");

					const response = await execHerdrJson<{
						result: {
							type: string;
							pane_id: string;
							revision: number;
							matched_line: string;
							read: PaneReadResult;
						};
					}>(args);
					const matched = response.result;
					const text = matched.read?.text ? formatReadOutput(matched.read.text) : matched.matched_line;

					return {
						content: [{ type: "text", text: `Matched: ${matched.matched_line}\n\n${text}` }],
						details: withSnapshot({
							action: "watch",
							pane: resolved.alias || paneRef,
							paneId: resolved.pane.pane_id,
							matchedLine: matched.matched_line,
						}),
					};
				}

				case "wait_agent": {
					const paneRef = params.pane;
					const status = params.status;
					if (!paneRef) throw new Error("'pane' is required for wait_agent");
					if (!status) throw new Error("'status' is required for wait_agent");

					const resolved = await resolvePaneRef(paneRef, currentWorkspaceId);
					if (!resolved) throw new Error(`Pane '${paneRef}' not found in the current workspace.`);

					const args = ["wait", "agent-status", resolved.pane.pane_id, "--status", status];
					if (params.timeout != null) args.push("--timeout", String(params.timeout));

					const response = await execHerdrJson<{
						event: string;
						data: {
							agent?: string;
							pane_id: string;
							agent_status: AgentStatus;
							workspace_id: string;
						};
					}>(args);

					return {
						content: [
							{
								type: "text",
								text: `Agent in pane '${resolved.alias || paneRef}' reached status '${response.data.agent_status}'.`,
							},
						],
						details: withSnapshot({
							action: "wait_agent",
							pane: resolved.alias || paneRef,
							paneId: resolved.pane.pane_id,
							status: response.data.agent_status,
							agent: response.data.agent,
						}),
					};
				}

				case "send": {
					const paneRef = params.pane;
					if (!paneRef) throw new Error("'pane' is required for send");
					if (!params.text && !params.keys) throw new Error("'text' or 'keys' is required for send");

					const resolved = await resolvePaneRef(paneRef, currentWorkspaceId);
					if (!resolved) throw new Error(`Pane '${paneRef}' not found in the current workspace.`);

					if (params.text) {
						await execHerdr(["pane", "send-text", resolved.pane.pane_id, params.text]);
					}
					if (params.keys) {
						const keys = params.keys.split(/\s+/).filter(Boolean);
						await execHerdr(["pane", "send-keys", resolved.pane.pane_id, ...keys]);
					}

					const desc = [params.text && `"${params.text}"`, params.keys].filter(Boolean).join(" + ");
					return {
						content: [{ type: "text", text: `Sent ${desc} to pane '${resolved.alias || paneRef}'` }],
						details: withSnapshot({
							action: "send",
							pane: resolved.alias || paneRef,
							paneId: resolved.pane.pane_id,
							text: params.text,
							keys: params.keys,
						}),
					};
				}

				case "stop": {
					const paneRef = params.pane;
					if (!paneRef) throw new Error("'pane' is required for stop");

					const resolved = await resolvePaneRef(paneRef, currentWorkspaceId);
					if (!resolved) throw new Error(`Pane '${paneRef}' not found in the current workspace.`);
					if (resolved.pane.pane_id === currentPaneId) {
						throw new Error("Refusing to close the pane pi is running in.");
					}

					await execHerdr(["pane", "close", resolved.pane.pane_id]);
					if (resolved.alias) forgetAlias(resolved.alias);

					return {
						content: [{ type: "text", text: `Closed pane '${resolved.alias || paneRef}'` }],
						details: withSnapshot({
							action: "stop",
							pane: resolved.alias || paneRef,
							paneId: resolved.pane.pane_id,
						}),
					};
				}

				default:
					throw new Error(`Unknown action: ${params.action}`);
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("herdr "));
			text += theme.fg("accent", args.action || "?");
			if (args.workspace) text += theme.fg("muted", ` ${args.workspace}`);
			if (args.tab) text += theme.fg("muted", ` ${args.tab}`);
			if (args.pane) text += theme.fg("muted", ` ${args.pane}`);
			if (args.command) text += theme.fg("dim", ` › ${args.command}`);
			if (args.match) text += theme.fg("dim", ` › ${args.match}`);
			if (args.status) text += theme.fg("dim", ` › ${args.status}`);
			if (args.text) text += theme.fg("dim", ` › \"${args.text}\"`);
			if (args.keys) text += theme.fg("dim", ` › ${args.keys}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as Record<string, any> | undefined;
			if (!details) {
				const content = result.content?.[0];
				return new Text(content?.type === "text" ? content.text : "", 0, 0);
			}

			switch (details.action) {
				case "run": {
					let text = theme.fg("success", `▶ ${details.pane}`);
					text += theme.fg("dim", ` › ${details.command}`);
					return new Text(text, 0, 0);
				}
				case "read": {
					let text = theme.fg("accent", `📄 ${details.pane}`);
					if (expanded) {
						const content = result.content?.[0];
						if (content?.type === "text") {
							const outputLines = content.text.split("\n").slice(0, 40);
							text += "\n" + outputLines.map((line: string) => theme.fg("dim", line)).join("\n");
						}
					}
					return new Text(text, 0, 0);
				}
				case "watch": {
					let text = theme.fg("success", `✓ ${details.pane}`);
					text += theme.fg("dim", ` › ${details.matchedLine}`);
					return new Text(text, 0, 0);
				}
				case "wait_agent": {
					let text = theme.fg("success", `◎ ${details.pane}`);
					text += theme.fg("dim", ` › ${details.status}`);
					if (details.agent) text += theme.fg("muted", ` (${details.agent})`);
					return new Text(text, 0, 0);
				}
				case "send": {
					const desc = [details.text && `"${details.text}"`, details.keys].filter(Boolean).join(" + ");
					return new Text(theme.fg("accent", `⏎ ${details.pane} › ${desc}`), 0, 0);
				}
				case "stop": {
					return new Text(theme.fg("warning", `■ ${details.pane}`), 0, 0);
				}
				case "workspace_create":
				case "workspace_focus": {
					return new Text(theme.fg("accent", `▣ ${details.workspace?.label || details.workspace?.workspace_id}`), 0, 0);
				}
				case "tab_create":
				case "tab_focus": {
					return new Text(theme.fg("accent", `▤ ${details.tab?.label || details.tab?.tab_id}`), 0, 0);
				}
				case "focus": {
					return new Text(theme.fg("accent", `◎ ${details.target}`), 0, 0);
				}
				case "workspace_list": {
					const workspaces = details.workspaces as WorkspaceInfo[];
					if (!workspaces?.length) return new Text(theme.fg("dim", "no workspaces"), 0, 0);
					const lines = workspaces.map((workspace) => {
						const dot = statusDot(theme, workspace.agent_status);
						const label = theme.fg(workspace.focused ? "accent" : "muted", workspace.label || workspace.workspace_id);
						const extra = [workspace.workspace_id, workspace.agent_status !== "unknown" ? workspace.agent_status : null]
							.filter(Boolean)
							.join(" ");
						return `${dot} ${label}${extra ? ` ${theme.fg("dim", extra)}` : ""}`;
					});
					return new Text(lines.join("\n"), 0, 0);
				}
				case "tab_list": {
					const tabs = details.tabs as TabInfo[];
					if (!tabs?.length) return new Text(theme.fg("dim", "no tabs"), 0, 0);
					const lines = tabs.map((tab) => {
						const dot = statusDot(theme, tab.agent_status);
						const label = theme.fg(tab.focused ? "accent" : "muted", tab.label || tab.tab_id);
						const extra = [tab.tab_id, tab.agent_status !== "unknown" ? tab.agent_status : null].filter(Boolean).join(" ");
						return `${dot} ${label}${extra ? ` ${theme.fg("dim", extra)}` : ""}`;
					});
					return new Text(lines.join("\n"), 0, 0);
				}
				case "list": {
					const panes = details.panes as PaneInfo[];
					if (!panes?.length) return new Text(theme.fg("dim", "no panes"), 0, 0);
					const paneAliases = (details.paneAliases || {}) as Record<string, string>;
					const lines = panes.map((pane) => {
						const dot = statusDot(theme, pane.agent_status);
						const label = paneAliases[pane.pane_id]
							? theme.fg("accent", paneAliases[pane.pane_id])
							: theme.fg("muted", pane.pane_id);
						const extra = [pane.agent, pane.agent_status !== "unknown" ? pane.agent_status : null].filter(Boolean).join(" ");
						return `${dot} ${label}${extra ? ` ${theme.fg("dim", extra)}` : ""}`;
					});
					return new Text(lines.join("\n"), 0, 0);
				}
				default: {
					const content = result.content?.[0];
					return new Text(content?.type === "text" ? content.text : "", 0, 0);
				}
			}
		},
	});
}
