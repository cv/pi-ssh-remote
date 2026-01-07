/**
 * Ls tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockLsExecute,
	mockCreateLsTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - ls tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should execute ls locally when SSH is not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockLsExecute.mockResolvedValue({
			content: [{ type: "text", text: "file1.txt\nfile2.txt\ndir1\n" }],
			details: {},
		});

		const ctx = createMockContext();
		const lsTool = api._registeredTools.get("ls");

		const result = await lsTool.execute("tool-1", {}, undefined, ctx, undefined);

		// Verify delegation to pi's built-in ls tool
		expect(mockCreateLsTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockLsExecute).toHaveBeenCalled();
		expect(result.content[0].text).toContain("file1.txt");
		expect(result.details.remote).toBe(false);
	});

	it("should execute ls via SSH when configured", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "remote_file.txt\n",
			stderr: "",
			code: 0,
		});

		extensionFn(api);

		// Configure SSH via command
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com /home", ctx);

		const lsTool = api._registeredTools.get("ls");
		const result = await lsTool.execute("tool-1", { path: "/var/log" }, undefined, ctx, undefined);

		expect(api.exec).toHaveBeenCalledWith("ssh", expect.arrayContaining(["user@remote.com"]), expect.any(Object));
		expect(result.details.remote).toBe(true);
	});

	it("should return '(empty directory)' for empty directories (remote)", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 0,
		});

		extensionFn(api);

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com", ctx);

		const lsTool = api._registeredTools.get("ls");

		const result = await lsTool.execute("tool-1", { path: "/empty" }, undefined, ctx, undefined);

		expect(result.content[0].text).toBe("(empty directory)");
	});

	it("should handle ls errors (remote)", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "",
			stderr: "No such file or directory",
			code: 2,
		});

		extensionFn(api);

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com", ctx);

		const lsTool = api._registeredTools.get("ls");

		const result = await lsTool.execute("tool-1", { path: "/nonexistent" }, undefined, ctx, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error");
	});

	it("should apply default SSH timeout to ls tool when configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "file1.txt\nfile2.txt\n",
			stderr: "",
			code: 0,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 60", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const lsTool = api._registeredTools.get("ls");
		await lsTool.execute("tool-1", { path: "/var" }, undefined, ctx, undefined);

		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@host.com", expect.stringContaining("ls ")],
			expect.objectContaining({ timeout: 60000 })
		);
	});
});
