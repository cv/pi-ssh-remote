/**
 * Edit tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockEditExecute,
	mockCreateEditTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - edit tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should edit file locally when no SSH host configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockEditExecute.mockResolvedValue({
			content: [{ type: "text", text: "Successfully edited test.txt (+0 lines)" }],
			details: { path: "test.txt", lineDelta: 0 },
		});

		const ctx = createMockContext();
		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "hello", newText: "goodbye" },
			undefined,
			ctx,
			undefined
		);

		// Verify delegation to pi's built-in edit tool
		expect(mockCreateEditTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockEditExecute).toHaveBeenCalled();
		expect(result.content[0].text).toContain("Successfully edited");
		expect(result.details.remote).toBe(false);
	});

	it("should fail when oldText is not found (remote)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "hello world",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "nonexistent", newText: "replacement" },
			undefined,
			ctx,
			undefined
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("oldText not found");
	});

	it("should fail when oldText appears multiple times (remote)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "hello hello hello",
			stderr: "",
			code: 0,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "hello", newText: "goodbye" },
			undefined,
			ctx,
			undefined
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("appears 3 times");
	});

	it("should handle edit read errors (remote)", async () => {
		const api = createMockExtensionAPI();
		const execMock = jest.fn().mockResolvedValue({
			stdout: "",
			stderr: "Permission denied",
			code: 1,
			killed: false,
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote error handling
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "hello", newText: "goodbye" },
			undefined,
			ctx,
			undefined
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error reading file");
	});

	it("should handle edit write errors (remote)", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Read succeeds
				return Promise.resolve({ stdout: "hello world", stderr: "", code: 0, killed: false });
			}
			// Write fails
			return Promise.resolve({ stdout: "", stderr: "Disk full", code: 1, killed: false });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote error handling
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "hello", newText: "goodbye" },
			undefined,
			ctx,
			undefined
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error writing file");
	});

	it("should apply default SSH timeout to edit tool when configured", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ stdout: "hello world", stderr: "", code: 0, killed: false });
			}
			return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 40", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const editTool = api._registeredTools.get("edit");
		await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "hello", newText: "goodbye" },
			undefined,
			ctx,
			undefined
		);

		// Both read and write calls should have timeout
		expect(execMock).toHaveBeenCalledWith("ssh", expect.any(Array), expect.objectContaining({ timeout: 40000 }));
	});

	it("should handle edit with negative line delta (remote)", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ stdout: "line1\nline2\nline3\nline4", stderr: "", code: 0, killed: false });
			}
			return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Configure SSH to test remote edit behavior
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const editTool = api._registeredTools.get("edit");

		const result = await editTool.execute(
			"tool-1",
			{ path: "test.txt", oldText: "line2\nline3\n", newText: "" },
			undefined,
			ctx,
			undefined
		);

		expect(result.details.lineDelta).toBe(-2);
	});
});
