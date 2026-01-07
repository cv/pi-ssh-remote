/**
 * Read tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockReadExecute,
	mockCreateReadTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - read tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should read file locally when no SSH host configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockReadExecute.mockResolvedValue({
			content: [{ type: "text", text: "file content here" }],
			details: { path: "test.txt" },
		});

		const ctx = createMockContext();
		const readTool = api._registeredTools.get("read");

		const result = await readTool.execute("tool-1", { path: "test.txt" }, undefined, ctx, undefined);

		// Verify delegation to pi's built-in read tool
		expect(mockCreateReadTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockReadExecute).toHaveBeenCalled();
		expect(result.content[0].text).toBe("file content here");
		expect(result.details.remote).toBe(false);
	});

	it("should read file via SSH when host is configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "remote file content",
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

		const readTool = api._registeredTools.get("read");
		const result = await readTool.execute("tool-1", { path: "test.txt" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith("ssh", ["user@server.com", "cat 'test.txt'"], expect.any(Object));
		expect(result.content[0].text).toBe("remote file content");
		expect(result.details.remote).toBe(true);
	});

	it("should handle offset and limit parameters", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "line 10\nline 11\nline 12",
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

		const readTool = api._registeredTools.get("read");
		await readTool.execute("tool-1", { path: "test.txt", offset: 10, limit: 3 }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith("ssh", ["user@server.com", "sed -n '10,12p' 'test.txt'"], expect.any(Object));
	});

	it("should handle read with only offset (no limit)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "lines from offset",
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

		const readTool = api._registeredTools.get("read");
		await readTool.execute("tool-1", { path: "test.txt", offset: 50 }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith("ssh", ["user@server.com", "sed -n '50,$p' 'test.txt'"], expect.any(Object));
	});

	it("should handle read errors on remote", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "",
			stderr: "No such file or directory",
			code: 1,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const readTool = api._registeredTools.get("read");
		const result = await readTool.execute("tool-1", { path: "nonexistent.txt" }, undefined, ctx, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error reading file");
	});

	it("should apply default SSH timeout to read tool when configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "file content",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 25", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const readTool = api._registeredTools.get("read");
		await readTool.execute("tool-1", { path: "test.txt" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@host.com", "cat 'test.txt'"],
			expect.objectContaining({ timeout: 25000 })
		);
	});

	it("should handle read output truncation (remote)", async () => {
		const api = createMockExtensionAPI();
		const longContent = Array(3000).fill("line content").join("\n");
		const execMock = jest.fn().mockResolvedValue({
			stdout: longContent,
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

		const readTool = api._registeredTools.get("read");
		const result = await readTool.execute("tool-1", { path: "bigfile.txt" }, undefined, ctx, undefined);

		expect(result.content[0].text).toContain("[Output truncated:");
	});
});
