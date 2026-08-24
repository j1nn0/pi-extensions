import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import herdrWorktreeJump from "./index";

const originalForkFrom = SessionManager.forkFrom;
let testRoot: string;

function success(stdout = "") {
	return { stdout, stderr: "", code: 0, killed: false };
}

function json(result: unknown) {
	return success(JSON.stringify({ id: "test", result }));
}

function registerExtension(exec: (command: string, args: string[], options?: Record<string, unknown>) => unknown) {
	const tools = new Map<string, any>();
	const pi = {
		registerTool(definition: any) {
			tools.set(definition.name, definition);
		},
		exec,
	};
	herdrWorktreeJump(pi as any);
	return { pi, tools };
}

beforeEach(async () => {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w1:p1";
	testRoot = `/var/tmp/pi-herdr-worktree-jump-${crypto.randomUUID()}`;
	await mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
	SessionManager.forkFrom = originalForkFrom;
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	await rm(testRoot, { recursive: true, force: true });
});

describe("pi-herdr-worktree-jump", () => {
	test("registers only inside Herdr", () => {
		delete process.env.HERDR_ENV;
		const { tools } = registerExtension(async () => success());
		expect(tools.size).toBe(0);
	});

	test("requires an explicit user request in its model guidance", () => {
		const { tools } = registerExtension(async () => success());
		const tool = tools.get("herdr_worktree_jump");

		expect(tool).toBeDefined();
		expect(tool.promptSnippet).toContain("only when explicitly requested");
		expect(tool.promptGuidelines.join("\n")).toContain("only when the user explicitly asks");
		expect(tool.promptGuidelines.join("\n")).toContain("Never use herdr_worktree_jump merely because isolation");
	});

	test("resolves the source checkout through Herdr, creates a worktree, and starts the replacement Pi", async () => {
		const sourceCheckout = `${testRoot}/source`;
		const sourceSubdirectory = `${sourceCheckout}/src/nested`;
		const worktreePath = `${testRoot}/worktrees/issue-2325`;
		const currentSession = `${testRoot}/current.jsonl`;
		const newSession = `${testRoot}/new.jsonl`;
		await mkdir(sourceSubdirectory, { recursive: true });
		await mkdir(worktreePath, { recursive: true });
		await writeFile(currentSession, '{"type":"session","cwd":"source"}\n');
		await writeFile(
			newSession,
			`${JSON.stringify({ type: "session", cwd: worktreePath, parentSession: currentSession })}\n` +
				'{"type":"message","id":"12345678","parentId":null}\n',
		);

		SessionManager.forkFrom = (() => ({ getSessionFile: () => newSession })) as unknown as typeof SessionManager.forkFrom;

		const calls: Array<{ command: string; args: string[]; options?: Record<string, unknown> }> = [];
		const { tools } = registerExtension(async (command, args, options) => {
			calls.push({ command, args, options });
			if (command === "sh") return success();
			if (args[0] === "worktree" && args[1] === "list") {
				return json({ source: { source_checkout_path: sourceCheckout }, worktrees: [] });
			}
			if (args[0] === "worktree" && args[1] === "create") {
				return json({
					workspace: { workspace_id: "w2" },
					tab: { tab_id: "w2:t1" },
					root_pane: { pane_id: "w2:p1" },
					worktree: { path: worktreePath, branch: "issue/2325-jump" },
				});
			}
			if (args[0] === "pane" && args[1] === "run") return success();
			throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
		});

		const statuses: Array<[string, string | undefined]> = [];
		const notifications: string[] = [];
		let shutdown = false;
		const result = await tools.get("herdr_worktree_jump").execute(
			"jump",
			{ branch: " issue/2325-jump ", base: " HEAD ", label: " issue 2325 " },
			undefined,
			undefined,
			{
				cwd: sourceSubdirectory,
				sessionManager: { getSessionFile: () => currentSession },
				ui: {
					setStatus(name: string, value: string | undefined) {
						statuses.push([name, value]);
					},
					notify(message: string) {
						notifications.push(message);
					},
				},
				shutdown() {
					shutdown = true;
				},
			},
		);

		expect(calls[0]).toMatchObject({
			command: "herdr",
			args: ["worktree", "list", "--cwd", sourceSubdirectory],
			options: { cwd: sourceSubdirectory, timeout: 10_000 },
		});
		expect(calls[1]).toMatchObject({
			command: "herdr",
			args: [
				"worktree",
				"create",
				"--cwd",
				sourceCheckout,
				"--focus",
				"--branch",
				"issue/2325-jump",
				"--base",
				"HEAD",
				"--label",
				"issue 2325",
			],
		});
		const paneRun = calls.find((call) => call.command === "herdr" && call.args[0] === "pane");
		expect(paneRun?.args.slice(0, 3)).toEqual(["pane", "run", "w2:p1"]);
		expect(paneRun?.args[3]).toContain(`'pi' '--session' '${newSession}'`);
		expect(paneRun?.args[3]).toContain(worktreePath);
		expect(calls.at(-1)?.command).toBe("sh");

		const header = JSON.parse((await readFile(newSession, "utf8")).split("\n")[0]);
		expect(header.parentSession).toBeUndefined();
		expect(statuses.at(-1)).toEqual(["herdr-worktree-jump", undefined]);
		expect(notifications.at(-1)).toContain(worktreePath);
		expect(shutdown).toBe(true);
		expect(result.terminate).toBe(true);
		expect(result.details).toMatchObject({
			destination: "new",
			worktreePath,
			branch: "issue/2325-jump",
			workspaceId: "w2",
			paneId: "w2:p1",
		});
	});

	test("opens the main checkout and uses a fresh tab when its workspace is already open", async () => {
		const sourceCheckout = `${testRoot}/source`;
		const linkedCheckout = `${testRoot}/worktrees/linked`;
		const currentSession = `${testRoot}/current-main-jump.jsonl`;
		const newSession = `${testRoot}/new-main-jump.jsonl`;
		await mkdir(sourceCheckout, { recursive: true });
		await mkdir(linkedCheckout, { recursive: true });
		await writeFile(currentSession, '{"type":"session","cwd":"linked"}\n');
		await writeFile(
			newSession,
			`${JSON.stringify({ type: "session", cwd: sourceCheckout, parentSession: currentSession })}\n`,
		);

		SessionManager.forkFrom = (() => ({ getSessionFile: () => newSession })) as unknown as typeof SessionManager.forkFrom;

		const calls: Array<{ command: string; args: string[] }> = [];
		const { tools } = registerExtension(async (command, args) => {
			calls.push({ command, args });
			if (command === "sh") return success();
			if (args[0] === "worktree" && args[1] === "list") {
				return json({ source: { source_checkout_path: sourceCheckout }, worktrees: [] });
			}
			if (args[0] === "worktree" && args[1] === "open") {
				return json({
					workspace: { workspace_id: "w-main" },
					tab: { tab_id: "w-main:t-existing" },
					root_pane: { pane_id: "w-main:p-occupied" },
					worktree: { path: sourceCheckout, branch: "master" },
					already_open: true,
				});
			}
			if (args[0] === "tab" && args[1] === "create") {
				return json({
					tab: { tab_id: "w-main:t-new" },
					root_pane: { pane_id: "w-main:p-new" },
				});
			}
			if (args[0] === "pane" && args[1] === "run") return success();
			throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
		});

		let shutdown = false;
		const result = await tools.get("herdr_worktree_jump").execute(
			"jump-main",
			{ destination: "main" },
			undefined,
			undefined,
			{
				cwd: linkedCheckout,
				sessionManager: { getSessionFile: () => currentSession },
				ui: { setStatus() {}, notify() {} },
				shutdown() {
					shutdown = true;
				},
			},
		);

		expect(calls[1]).toEqual({
			command: "herdr",
			args: ["worktree", "open", "--cwd", sourceCheckout, "--path", sourceCheckout, "--focus"],
		});
		expect(calls[2]).toEqual({
			command: "herdr",
			args: ["tab", "create", "--workspace", "w-main", "--cwd", sourceCheckout, "--focus"],
		});
		const paneRun = calls.find((call) => call.command === "herdr" && call.args[0] === "pane");
		expect(paneRun?.args.slice(0, 3)).toEqual(["pane", "run", "w-main:p-new"]);
		expect(calls.some((call) => call.args[1] === "create" && call.args[0] === "worktree")).toBe(false);
		expect(shutdown).toBe(true);
		expect(result.details).toMatchObject({
			destination: "main",
			worktreePath: sourceCheckout,
			branch: "master",
			workspaceId: "w-main",
			tabId: "w-main:t-new",
			paneId: "w-main:p-new",
		});
	});

	test("refuses to jump when the current session is not persisted", async () => {
		const { tools } = registerExtension(async () => success());
		expect(
			tools.get("herdr_worktree_jump").execute("jump", {}, undefined, undefined, {
				cwd: testRoot,
				sessionManager: { getSessionFile: () => undefined },
				ui: { setStatus() {} },
			}),
		).rejects.toThrow("not persisted");
	});
});
