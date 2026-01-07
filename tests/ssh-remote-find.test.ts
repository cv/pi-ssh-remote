/**
 * Find tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockFindExecute,
	mockCreateFindTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - find tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should execute find locally when SSH is not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockFindExecute.mockResolvedValue({
			content: [{ type: "text", text: "./src/file.ts\n./lib/other.ts\n" }],
			details: {},
		});

		const ctx = createMockContext();
		const findTool = api._registeredTools.get("find");

		const result = await findTool.execute("tool-1", { pattern: "*.ts" }, undefined, ctx, undefined);

		// Verify delegation to pi's built-in find tool
		expect(mockCreateFindTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockFindExecute).toHaveBeenCalled();
		expect(result.content[0].text).toContain("file.ts");
		expect(result.details.remote).toBe(false);
	});

	it("should execute find via SSH when configured", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "./remote/file.txt\n",
			stderr: "",
			code: 0,
		});

		extensionFn(api);

		// Configure SSH via command
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com", ctx);

		const findTool = api._registeredTools.get("find");
		const result = await findTool.execute("tool-1", { pattern: "*.txt", path: "/var" }, undefined, ctx, undefined);

		expect(api.exec).toHaveBeenCalledWith("ssh", expect.arrayContaining(["user@remote.com"]), expect.any(Object));
		expect(result.details.remote).toBe(true);
	});

	it("should return 'No files found' when find finds nothing (remote)", async () => {
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

		const findTool = api._registeredTools.get("find");

		const result = await findTool.execute("tool-1", { pattern: "*.nonexistent" }, undefined, ctx, undefined);

		expect(result.content[0].text).toBe("No files found matching pattern");
	});

	it("should use fd when available on remote", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		(api.exec as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection call
				return Promise.resolve({
					stdout: "rg:yes\nfd:yes\n",
					stderr: "",
					code: 0,
				});
			}
			// Actual find call
			return Promise.resolve({
				stdout: "./file.txt\n",
				stderr: "",
				code: 0,
			});
		});

		extensionFn(api);
		const ctx = createMockContext();

		// Configure SSH
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const findTool = api._registeredTools.get("find");
		await findTool.execute("tool-1", { pattern: "*.txt" }, undefined, ctx, undefined);

		// Check that the second call (find execution) uses fd
		const calls = (api.exec as jest.Mock).mock.calls;
		const findCall = calls[1];
		expect(findCall[1].some((arg: string) => arg.includes("fd "))).toBe(true);
	});

	it("should apply default SSH timeout to find tool when configured", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection call
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			return Promise.resolve({ stdout: "./file.txt\n", stderr: "", code: 0 });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 55", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const findTool = api._registeredTools.get("find");
		await findTool.execute("tool-1", { pattern: "*.txt" }, undefined, ctx, undefined);

		// The find execution call (second call) should have timeout
		const calls = execMock.mock.calls;
		expect(calls[1][2]).toEqual(expect.objectContaining({ timeout: 55000 }));
	});

	it("should handle SSH execution errors in find", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection succeeds
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			// Find execution fails
			return Promise.reject(new Error("Network unreachable"));
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const findTool = api._registeredTools.get("find");
		const result = await findTool.execute("tool-1", { pattern: "*.txt" }, undefined, ctx, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Network unreachable");
		expect(result.details.error).toBe("Network unreachable");
	});

	it("should render find call with host prefix when SSH configured", () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure SSH
		const ctx = createMockContext();
		const sshCommand = api._registeredCommands.get("ssh");
		sshCommand.handler("user@remote.com", ctx);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = findTool.renderCall({ pattern: "*.ts" }, mockTheme);
		expect(rendered.text).toContain("user@remote.com");
		expect(rendered.text).toContain("find *.ts");
	});

	it("should render find call without prefix when SSH not configured", () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = findTool.renderCall({ pattern: "*.ts" }, mockTheme);
		expect(rendered.text).not.toContain("@");
		expect(rendered.text).toContain("find *.ts");
	});

	it("should fall back to find when fd not available", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		(api.exec as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			return Promise.resolve({ stdout: "./file.txt\n", stderr: "", code: 0 });
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const findTool = api._registeredTools.get("find");
		await findTool.execute("tool-1", { pattern: "*.txt" }, undefined, ctx, undefined);

		const calls = (api.exec as jest.Mock).mock.calls;
		const findCall = calls[1];
		expect(findCall[1].some((arg: string) => arg.includes("find "))).toBe(true);
	});
});
