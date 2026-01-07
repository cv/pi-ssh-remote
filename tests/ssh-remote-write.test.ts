/**
 * Write tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockWriteExecute,
	mockCreateWriteTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - write tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should write file locally when no SSH host configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const content = "hello world";
		// Configure mock to return expected result
		mockWriteExecute.mockResolvedValue({
			content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to test.txt` }],
			details: { path: "test.txt", bytes: content.length },
		});

		const ctx = createMockContext();
		const writeTool = api._registeredTools.get("write");

		const result = await writeTool.execute("tool-1", { path: "test.txt", content }, undefined, ctx, undefined);

		// Verify delegation to pi's built-in write tool
		expect(mockCreateWriteTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockWriteExecute).toHaveBeenCalled();
		expect(result.content[0].text).toContain("Successfully wrote");
		expect(result.details.bytes).toBe(content.length);
		expect(result.details.remote).toBe(false);
	});

	it("should write file via SSH with base64 encoding", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "",
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

		const writeTool = api._registeredTools.get("write");
		const content = "hello world";
		const result = await writeTool.execute("tool-1", { path: "test.txt", content }, undefined, ctx, undefined);

		// Should use base64 encoding
		expect(execMock).toHaveBeenCalledWith(
			"ssh",
			["user@server.com", expect.stringContaining("base64 -d")],
			expect.any(Object)
		);
		expect(result.content[0].text).toContain("Successfully wrote");
		expect(result.details.remote).toBe(true);
	});

	it("should handle write errors on remote", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// mkdir succeeds
				return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
			}
			// write fails
			return Promise.resolve({ stdout: "", stderr: "Permission denied", code: 1, killed: false });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const writeTool = api._registeredTools.get("write");
		const result = await writeTool.execute(
			"tool-1",
			{ path: "/root/test.txt", content: "test" },
			undefined,
			ctx,
			undefined
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error writing file");
	});

	it("should apply default SSH timeout to write tool when configured", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 35", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const writeTool = api._registeredTools.get("write");
		await writeTool.execute("tool-1", { path: "test.txt", content: "hello" }, undefined, ctx, undefined);

		// First call is mkdir, second is write - both should have timeout
		expect(execMock).toHaveBeenCalledWith("ssh", expect.any(Array), expect.objectContaining({ timeout: 35000 }));
	});
});
