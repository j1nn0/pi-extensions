import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";

type HerdrEnvelope<T> = {
	result?: T;
	error?: { code?: string; message?: string };
};

type WorktreeSource = {
	source_checkout_path?: string;
};

type WorktreeOpened = {
	workspace?: { workspace_id?: string };
	tab?: { tab_id?: string };
	root_pane?: { pane_id?: string };
	worktree?: { path?: string; branch?: string };
	already_open?: boolean;
};

type TabCreated = {
	tab?: { tab_id?: string };
	root_pane?: { pane_id?: string };
};

type JumpDestination = "new" | "main";

type JumpOptions = {
	destination: JumpDestination;
	branch?: string;
	base?: string;
	label?: string;
};

type JumpTarget = {
	worktreePath: string;
	branch?: string;
	workspaceId?: string;
	tabId?: string;
	rootPaneId: string;
};

export default function (pi: ExtensionAPI) {
	if (process.env.HERDR_ENV !== "1") return;

	pi.registerTool({
		name: "herdr_worktree_jump",
		label: "Herdr Worktree Jump",
		description:
			"Relocate this Pi session either into a newly created linked Git worktree or back to the repository's main checkout, using Herdr to create or open the destination workspace. The replacement Pi starts in a dedicated Herdr pane, then the old Pi shuts down and its pane closes. This is an explicit session relocation, not a general isolation or worktree-planning tool.",
		promptSnippet: "Jump this Pi session to a new worktree or back to the main checkout only when explicitly requested",
		promptGuidelines: [
			"Use herdr_worktree_jump only when the user explicitly asks to jump or move this Pi session into a new worktree or back to the repository's main checkout.",
			"Never use herdr_worktree_jump merely because isolation would be useful, repository instructions recommend a worktree, or the task appears non-trivial.",
		],
		parameters: Type.Object({
			destination: Type.Optional(
				StringEnum(["new", "main"] as const, {
					description: "Use new to create a worktree, or main to return to the repository's main checkout. Defaults to new.",
				}),
			),
			branch: Type.Optional(
				Type.String({
					description: "Branch name for destination=new. If omitted, Herdr generates one.",
				}),
			),
			base: Type.Optional(
				Type.String({
					description: "Git ref used as the new branch base for destination=new. If omitted, Herdr uses HEAD.",
				}),
			),
			label: Type.Optional(
				Type.String({
					description: "Optional Herdr workspace label for destination=new.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return jumpToWorktree(pi, ctx, signal, {
				destination: params.destination ?? "new",
				branch: cleanOptional(params.branch),
				base: cleanOptional(params.base),
				label: cleanOptional(params.label),
			});
		},
	});
}

async function jumpToWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	options: JumpOptions,
) {
	const oldPaneId = process.env.HERDR_PANE_ID;
	if (!oldPaneId) {
		throw new Error("HERDR_PANE_ID is missing; cannot close the old Herdr pane safely");
	}

	const currentFile = ctx.sessionManager.getSessionFile();
	if (!currentFile) {
		throw new Error("Current Pi session is not persisted, so it cannot jump to a worktree");
	}
	if (options.destination === "main" && (options.branch || options.base || options.label)) {
		throw new Error("branch, base, and label apply only when destination is new");
	}

	ctx.ui.setStatus("herdr-worktree-jump", "resolving repository");
	let newSessionFile: string | undefined;
	let replacementStarted = false;

	try {
		const sourceCheckout = await resolveSourceCheckout(pi, signal, ctx.cwd);
		let target: JumpTarget;
		if (options.destination === "main") {
			const currentDirectory = await canonicalDirectory(ctx.cwd);
			if (isWithinDirectory(sourceCheckout, currentDirectory)) {
				throw new Error(`Pi is already inside the main checkout: ${sourceCheckout}`);
			}
			ctx.ui.setStatus("herdr-worktree-jump", "opening main checkout");
			target = await openMainCheckout(pi, signal, sourceCheckout);
		} else {
			ctx.ui.setStatus("herdr-worktree-jump", "creating worktree");
			target = await createWorktree(pi, signal, sourceCheckout, options);
		}
		const worktreePath = await canonicalDirectory(target.worktreePath);

		newSessionFile = await forkSessionFile(currentFile, worktreePath);
		await runInNewPane(pi, signal, target.rootPaneId, newSessionFile, worktreePath);
		replacementStarted = true;

		let cleanupWarning: string | undefined;
		try {
			await scheduleOldPaneCleanup(pi, currentFile, oldPaneId, process.pid);
		} catch (error) {
			cleanupWarning = error instanceof Error ? error.message : String(error);
		}

		ctx.ui.setStatus("herdr-worktree-jump", undefined);
		const destinationLabel = options.destination === "main" ? "main checkout" : "worktree";
		ctx.ui.notify(`Jumped Pi session to Herdr ${destinationLabel}: ${worktreePath}`, "info");
		ctx.shutdown();

		const warning = cleanupWarning
			? `\n\nWarning: the old pane could not be scheduled for automatic cleanup: ${cleanupWarning}`
			: "";

		return {
			content: [
				{
					type: "text" as const,
					text:
						`Started replacement Pi in Herdr ${destinationLabel}: ${worktreePath}\n` +
						`Workspace: ${target.workspaceId ?? "unknown"}\n` +
						`Pane: ${target.rootPaneId}\n` +
						`Branch: ${target.branch ?? (options.destination === "new" ? "generated by Herdr" : "detached")}\n\n` +
						"The old Pi process is shutting down. Its pane will close after it exits." +
						warning,
				},
			],
			details: {
				destination: options.destination,
				worktreePath,
				branch: target.branch,
				workspaceId: target.workspaceId,
				tabId: target.tabId,
				paneId: target.rootPaneId,
				newSessionFile,
				oldSessionFile: currentFile,
				oldPaneId,
				cleanupWarning,
			},
			terminate: true,
		};
	} catch (error) {
		ctx.ui.setStatus("herdr-worktree-jump", undefined);
		if (newSessionFile && !replacementStarted) {
			await rm(newSessionFile, { force: true }).catch(() => undefined);
		}
		throw error;
	}
}

async function resolveSourceCheckout(
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	cwd: string,
): Promise<string> {
	const response = await herdrJson<{ source?: WorktreeSource }>(
		pi,
		["worktree", "list", "--cwd", cwd],
		signal,
		cwd,
		10_000,
	);
	const sourcePath = response.result?.source?.source_checkout_path;
	if (!sourcePath) {
		throw new Error("Herdr worktree list response did not include source.source_checkout_path");
	}
	return canonicalDirectory(sourcePath);
}

async function createWorktree(
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	sourceCheckout: string,
	options: JumpOptions,
): Promise<JumpTarget> {
	const args = ["worktree", "create", "--cwd", sourceCheckout, "--focus"];
	if (options.branch) args.push("--branch", options.branch);
	if (options.base) args.push("--base", options.base);
	if (options.label) args.push("--label", options.label);

	const response = await herdrJson<WorktreeOpened>(pi, args, signal, sourceCheckout, 120_000);
	const worktreePath = response.result?.worktree?.path;
	const rootPaneId = response.result?.root_pane?.pane_id;
	if (!worktreePath || !rootPaneId) {
		throw new Error("Herdr worktree create response did not include worktree.path and root_pane.pane_id");
	}

	return {
		worktreePath,
		rootPaneId,
		branch: response.result?.worktree?.branch,
		workspaceId: response.result?.workspace?.workspace_id,
		tabId: response.result?.tab?.tab_id,
	};
}

async function openMainCheckout(
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	sourceCheckout: string,
): Promise<JumpTarget> {
	const response = await herdrJson<WorktreeOpened>(
		pi,
		["worktree", "open", "--cwd", sourceCheckout, "--path", sourceCheckout, "--focus"],
		signal,
		sourceCheckout,
		30_000,
	);
	const workspaceId = response.result?.workspace?.workspace_id;
	if (!workspaceId) {
		throw new Error("Herdr worktree open response did not include workspace.workspace_id");
	}

	if (response.result?.already_open) {
		const tabResponse = await herdrJson<TabCreated>(
			pi,
			["tab", "create", "--workspace", workspaceId, "--cwd", sourceCheckout, "--focus"],
			signal,
			sourceCheckout,
			10_000,
		);
		const tabId = tabResponse.result?.tab?.tab_id;
		const rootPaneId = tabResponse.result?.root_pane?.pane_id;
		if (!tabId || !rootPaneId) {
			throw new Error("Herdr tab create response did not include tab.tab_id and root_pane.pane_id");
		}
		return {
			worktreePath: sourceCheckout,
			rootPaneId,
			branch: response.result.worktree?.branch,
			workspaceId,
			tabId,
		};
	}

	const worktreePath = response.result?.worktree?.path ?? sourceCheckout;
	const rootPaneId = response.result?.root_pane?.pane_id;
	if (!rootPaneId) {
		throw new Error("Herdr worktree open response did not include root_pane.pane_id");
	}
	return {
		worktreePath,
		rootPaneId,
		branch: response.result?.worktree?.branch,
		workspaceId,
		tabId: response.result?.tab?.tab_id,
	};
}

async function runInNewPane(
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	paneId: string,
	sessionFile: string,
	worktreePath: string,
): Promise<void> {
	const continuation = `Moved to worktree ${worktreePath}. Continue.`;
	const command = ["pi", "--session", sessionFile, continuation].map(shellQuote).join(" ");
	await herdr(pi, ["pane", "run", paneId, command], signal, worktreePath, 10_000);
}

async function scheduleOldPaneCleanup(
	pi: ExtensionAPI,
	oldSessionFile: string,
	oldPaneId: string,
	oldPid: number,
): Promise<void> {
	const cleanup = [
		`old_pid=${oldPid}`,
		`old_session=${shellQuote(oldSessionFile)}`,
		`old_pane=${shellQuote(oldPaneId)}`,
		"i=0",
		"while kill -0 \"$old_pid\" 2>/dev/null && [ \"$i\" -lt 600 ]; do i=$((i + 1)); sleep 0.1; done",
		"rm -f -- \"$old_session\"",
		"herdr pane close \"$old_pane\" >/dev/null 2>&1 || true",
	].join("; ");

	const launcher =
		"if command -v setsid >/dev/null 2>&1; then " +
		`setsid sh -c ${shellQuote(cleanup)} >/dev/null 2>&1 < /dev/null & ` +
		"else " +
		`nohup sh -c ${shellQuote(cleanup)} >/dev/null 2>&1 < /dev/null & ` +
		"fi";

	const result = await pi.exec("sh", ["-lc", launcher], { timeout: 5_000 });
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || "failed to launch cleanup process");
	}
}

async function forkSessionFile(currentFile: string, worktreePath: string): Promise<string> {
	const forked = SessionManager.forkFrom(currentFile, worktreePath);
	const newFile = forked.getSessionFile();
	if (!newFile) {
		throw new Error("Failed to create forked Pi session file for the new worktree");
	}

	const raw = await readFile(newFile, "utf8");
	const lines = raw.trimEnd().split("\n");
	if (lines[0]) {
		const header = JSON.parse(lines[0]) as Record<string, unknown>;
		if (header.parentSession !== undefined) {
			delete header.parentSession;
			lines[0] = JSON.stringify(header);
			await writeFile(newFile, `${lines.join("\n")}\n`, "utf8");
		}
	}

	return newFile;
}

async function canonicalDirectory(path: string): Promise<string> {
	const resolved = resolve(path.replace(/^@/, ""));
	const info = await stat(resolved).catch(() => undefined);
	if (!info?.isDirectory()) {
		throw new Error(`Directory does not exist: ${resolved}`);
	}
	return realpath(resolved);
}

function isWithinDirectory(parent: string, child: string): boolean {
	const pathFromParent = relative(parent, child);
	return (
		pathFromParent === "" ||
		(pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
	);
}

async function herdrJson<T>(
	pi: ExtensionAPI,
	args: string[],
	signal: AbortSignal | undefined,
	cwd: string,
	timeout: number,
): Promise<HerdrEnvelope<T>> {
	const result = await herdr(pi, args, signal, cwd, timeout);
	const raw = result.stdout.trim() || result.stderr.trim();
	let response: HerdrEnvelope<T>;
	try {
		response = JSON.parse(raw) as HerdrEnvelope<T>;
	} catch {
		throw new Error(`Herdr returned non-JSON output for ${args.join(" ")}: ${raw}`);
	}
	if (response.error) {
		throw new Error(`${response.error.code ?? "herdr_error"}: ${response.error.message ?? "unknown Herdr error"}`);
	}
	return response;
}

async function herdr(
	pi: ExtensionAPI,
	args: string[],
	signal: AbortSignal | undefined,
	cwd: string,
	timeout: number,
) {
	const result = await pi.exec("herdr", args, { cwd, signal, timeout });
	if (signal?.aborted || result.killed) throw new Error("Aborted");
	if (result.code !== 0) {
		throw new Error(parseHerdrFailure(result.stderr, result.stdout, args));
	}
	return result;
}

function parseHerdrFailure(stderr: string, stdout: string, args: string[]): string {
	for (const output of [stderr, stdout]) {
		const trimmed = output.trim();
		if (!trimmed) continue;
		try {
			const response = JSON.parse(trimmed) as HerdrEnvelope<unknown>;
			if (response.error) {
				return `${response.error.code ?? "herdr_error"}: ${response.error.message ?? "unknown Herdr error"}`;
			}
		} catch {
			return trimmed;
		}
	}
	return `herdr ${args.join(" ")} failed`;
}

function cleanOptional(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}
