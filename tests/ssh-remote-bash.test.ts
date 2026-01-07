/**
 * Bash tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockBashExecute,
	mockCreateBashTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - bash tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should execute locally when no SSH host configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockBashExecute.mockResolvedValue({
			content: [{ type: "text", text: "hello world" }],
			details: { exitCode: 0 },
		});

		const ctx = createMockContext();
		const bashTool = api._registeredTools.get("bash");

		const result = await bashTool.execute("tool-1", { command: "echo hello" }, undefined, ctx, undefined);

		// Verify delegation to pi's built-in bash tool
		expect(mockCreateBashTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockBashExecute).toHaveBeenCalledWith(
			"tool-1",
			{ command: "echo hello", timeout: undefined },
			undefined,
			undefined
		);
		expect(result.content[0].text).toBe("hello world");
		expect(result.details.remote).toBe(false);
	});

	it("should execute via SSH when host is configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "remote output",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const bashTool = api._registeredTools.get("bash");
		const result = await bashTool.execute("tool-1", { command: "ls -la" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith("ssh", ["user@server.com", "ls -la"], expect.any(Object));
		expect(result.content[0].text).toBe("remote output");
		expect(result.details.remote).toBe(true);
		expect(result.details.host).toBe("user@server.com");
	});

	it("should prepend cd command when remoteCwd is set", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "output",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH with cwd
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com /home/user/project", ctx);

		const bashTool = api._registeredTools.get("bash");
		await bashTool.execute("tool-1", { command: "pwd" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@server.com", "cd '/home/user/project' && pwd"],
			expect.any(Object)
		);
	});

	it("should include exit code in output for non-zero exit (remote)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "",
			stderr: "command not found",
			code: 127,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		const result = await bashTool.execute("tool-1", { command: "nonexistent" }, undefined, ctx, undefined);

		expect(result.content[0].text).toContain("[Exit code: 127]");
		expect(result.details.exitCode).toBe(127);
	});

	it("should handle bash execution errors (remote)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockRejectedValue(new Error("Connection refused"));
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote error handling
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		const result = await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Connection refused");
	});

	it("should handle timeout parameter in bash (local delegates to pi tool)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockBashExecute.mockResolvedValue({
			content: [{ type: "text", text: "done" }],
			details: { exitCode: 0 },
		});

		const ctx = createMockContext();
		const bashTool = api._registeredTools.get("bash");

		await bashTool.execute("tool-1", { command: "sleep 10", timeout: 5 }, undefined, ctx, undefined);

		// Verify delegation - timeout is passed to local tool
		expect(mockBashExecute).toHaveBeenCalledWith("tool-1", { command: "sleep 10", timeout: 5 }, undefined, undefined);
	});

	it("should apply default SSH timeout to bash tool when configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "done",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 30", ctx);

		// Configure SSH host
		await sshCommand.handler("user@host.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		await bashTool.execute("tool-1", { command: "echo test" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@host.com", "echo test"],
			expect.objectContaining({ timeout: 30000 })
		);
	});

	it("should allow tool-level timeout to override default SSH timeout", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "done",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 30", ctx);

		// Configure SSH host
		await sshCommand.handler("user@host.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		await bashTool.execute("tool-1", { command: "echo test", timeout: 10 }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@host.com", "echo test"],
			expect.objectContaining({ timeout: 10000 })
		);
	});

	it("should use CLI ssh-timeout flag as default", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "done",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		// Set CLI flag before session_start
		api._registeredFlags.get("ssh-timeout")!.value = "45";

		const ctx = createMockContext();

		// Trigger session_start to load CLI flag
		const sessionStartHandlers = api._eventHandlers.get("session_start")!;
		for (const handler of sessionStartHandlers) {
			await handler({}, ctx);
		}

		// Configure SSH host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@host.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		await bashTool.execute("tool-1", { command: "echo test" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@host.com", "echo test"],
			expect.objectContaining({ timeout: 45000 })
		);
	});

	it("should handle bash output truncation (remote)", async () => {
		const api = createMockExtensionAPI();
		// Generate output that will be truncated
		const longOutput = Array(3000).fill("line").join("\n");
		const execMock = jest.fn().mockResolvedValue({
			stdout: longOutput,
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote truncation
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const bashTool = api._registeredTools.get("bash");

		const result = await bashTool.execute("tool-1", { command: "cat bigfile" }, undefined, ctx, undefined);

		expect(result.content[0].text).toContain("[Output truncated:");
		expect(result.details.truncation).toBeDefined();
	});
});
