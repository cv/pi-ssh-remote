/**
 * Grep tool tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockGrepExecute,
	mockCreateGrepTool,
	resetAllMocks,
} from "./test-utils";

describe("ssh-remote extension - grep tool", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should execute grep locally when SSH is not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Configure mock to return expected result
		mockGrepExecute.mockResolvedValue({
			content: [{ type: "text", text: "file.txt:1:matching line\n" }],
			details: {},
		});

		const ctx = createMockContext();
		const grepTool = api._registeredTools.get("grep");

		const result = await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		// Verify delegation to pi's built-in grep tool
		expect(mockCreateGrepTool).toHaveBeenCalledWith(ctx.cwd);
		expect(mockGrepExecute).toHaveBeenCalled();
		expect(result.content[0].text).toContain("matching line");
		expect(result.details.remote).toBe(false);
	});

	it("should execute grep via SSH when configured", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "file.txt:1:remote match\n",
			stderr: "",
			code: 0,
		});

		extensionFn(api);

		// Configure SSH via command
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com /home/user", ctx);

		const grepTool = api._registeredTools.get("grep");
		const result = await grepTool.execute("tool-1", { pattern: "test", ignoreCase: true }, undefined, ctx, undefined);

		expect(api.exec).toHaveBeenCalledWith("ssh", expect.arrayContaining(["user@remote.com"]), expect.any(Object));
		expect(result.details.remote).toBe(true);
	});

	it("should return 'No matches found' when grep finds nothing (remote)", async () => {
		const api = createMockExtensionAPI();
		(api.exec as jest.Mock).mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 1,
		});

		extensionFn(api);

		// Configure SSH to test remote behavior
		const sshCommand = api._registeredCommands.get("ssh");
		const ctx = createMockContext();
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");

		const result = await grepTool.execute("tool-1", { pattern: "nonexistent" }, undefined, ctx, undefined);

		expect(result.content[0].text).toBe("No matches found");
	});

	it("should apply default SSH timeout to grep tool when configured", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection call
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			return Promise.resolve({ stdout: "file.txt:1:match\n", stderr: "", code: 0 });
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();

		// Set SSH timeout and host
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("timeout 50", ctx);
		await sshCommand.handler("user@host.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		// The grep execution call (second call) should have timeout
		const calls = execMock.mock.calls;
		expect(calls[1][2]).toEqual(expect.objectContaining({ timeout: 50000 }));
	});
});

describe("ssh-remote extension - grep error handling", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should handle SSH execution errors in grep", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		const execMock = jest.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection succeeds
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			// Grep execution fails
			return Promise.reject(new Error("Connection timeout"));
		});
		api._setExecMock(execMock);
		extensionFn(api);

		const ctx = createMockContext();
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		const result = await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Connection timeout");
		expect(result.details.error).toBe("Connection timeout");
	});

	it("should render grep call with host prefix when SSH configured", () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// First configure SSH so getHost() returns a value
		const ctx = createMockContext();
		const sshCommand = api._registeredCommands.get("ssh");
		sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = grepTool.renderCall({ pattern: "searchterm" }, mockTheme);
		expect(rendered.text).toContain("user@remote.com");
		expect(rendered.text).toContain("grep searchterm");
	});

	it("should render grep call without prefix when SSH not configured", () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = grepTool.renderCall({ pattern: "searchterm" }, mockTheme);
		expect(rendered.text).not.toContain("@");
		expect(rendered.text).toContain("grep searchterm");
	});

	it("should handle grep with all options using rg", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		(api.exec as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ stdout: "rg:yes\nfd:yes\n", stderr: "", code: 0 });
			}
			return Promise.resolve({ stdout: "file.txt:1:match\n", stderr: "", code: 0 });
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		await grepTool.execute(
			"tool-1",
			{ pattern: "test", ignoreCase: true, literal: true, context: 3, limit: 50 },
			undefined,
			ctx,
			undefined
		);

		const calls = (api.exec as jest.Mock).mock.calls;
		// The grep command is the last argument to ssh
		const sshArgs = calls[1][1];
		const grepCmd = sshArgs[sshArgs.length - 1];
		expect(grepCmd).toContain("-i");
		expect(grepCmd).toContain("-F");
		expect(grepCmd).toContain("-C3");
		expect(grepCmd).toContain("-m");
	});

	it("should handle grep with context option using grep fallback", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		(api.exec as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ stdout: "rg:no\nfd:no\n", stderr: "", code: 0 });
			}
			return Promise.resolve({ stdout: "file.txt:1:match\n", stderr: "", code: 0 });
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		await grepTool.execute("tool-1", { pattern: "test", context: 2 }, undefined, ctx, undefined);

		const calls = (api.exec as jest.Mock).mock.calls;
		// The grep command is the last argument to ssh
		const sshArgs = calls[1][1];
		const grepCmd = sshArgs[sshArgs.length - 1];
		expect(grepCmd).toContain("-C2");
		expect(grepCmd).toContain("grep ");
	});
});

describe("ssh-remote extension - remote tool detection (rg/fd)", () => {
	it("should return empty cache when no host configured (detectRemoteTools edge case)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		// Don't configure SSH - no host
		const ctx = createMockContext();

		// Call grep which internally calls detectRemoteTools
		// When no host is set, it should return hasRg: false, hasFd: false
		const grepTool = api._registeredTools.get("grep");

		// Configure mock for local execution
		const { mockGrepExecute, mockCreateGrepTool } = await import("./test-utils");
		mockGrepExecute.mockResolvedValue({
			content: [{ type: "text", text: "local result" }],
			details: {},
		});

		const result = await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		// Should delegate to local tool since no host configured
		expect(mockCreateGrepTool).toHaveBeenCalled();
		expect(result.details.remote).toBe(false);
	});

	it("should use rg when available on remote", async () => {
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
			// Actual grep call
			return Promise.resolve({
				stdout: "file.txt:1:match\n",
				stderr: "",
				code: 0,
			});
		});

		extensionFn(api);
		const ctx = createMockContext();

		// Configure SSH
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		// Check that the second call (grep execution) uses rg
		const calls = (api.exec as jest.Mock).mock.calls;
		const grepCall = calls[1];
		expect(grepCall[1].some((arg: string) => arg.includes("rg "))).toBe(true);
	});

	it("should fall back to grep when rg not available", async () => {
		const api = createMockExtensionAPI();
		let callCount = 0;
		(api.exec as jest.Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// Tool detection call - no rg/fd
				return Promise.resolve({
					stdout: "rg:no\nfd:no\n",
					stderr: "",
					code: 0,
				});
			}
			return Promise.resolve({
				stdout: "file.txt:1:match\n",
				stderr: "",
				code: 0,
			});
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");
		await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		const calls = (api.exec as jest.Mock).mock.calls;
		const grepCall = calls[1];
		expect(grepCall[1].some((arg: string) => arg.includes("grep "))).toBe(true);
	});

	it("should cache tool detection results", async () => {
		const api = createMockExtensionAPI();
		let detectionCalls = 0;
		(api.exec as jest.Mock).mockImplementation((cmd: string, args: string[]) => {
			// Check if this is a detection call
			if (args.some((arg: string) => arg.includes("command -v rg"))) {
				detectionCalls++;
				return Promise.resolve({
					stdout: "rg:yes\nfd:yes\n",
					stderr: "",
					code: 0,
				});
			}
			return Promise.resolve({
				stdout: "result\n",
				stderr: "",
				code: 0,
			});
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@remote.com", ctx);

		const grepTool = api._registeredTools.get("grep");

		// Call grep twice
		await grepTool.execute("tool-1", { pattern: "test1" }, undefined, ctx, undefined);
		await grepTool.execute("tool-2", { pattern: "test2" }, undefined, ctx, undefined);

		// Detection should only happen once (cached)
		expect(detectionCalls).toBe(1);
	});

	it("should invalidate cache when host changes", async () => {
		const api = createMockExtensionAPI();
		let detectionCalls = 0;
		(api.exec as jest.Mock).mockImplementation((cmd: string, args: string[]) => {
			if (args.some((arg: string) => arg.includes("command -v rg"))) {
				detectionCalls++;
				return Promise.resolve({
					stdout: "rg:yes\nfd:yes\n",
					stderr: "",
					code: 0,
				});
			}
			return Promise.resolve({
				stdout: "result\n",
				stderr: "",
				code: 0,
			});
		});

		extensionFn(api);
		const ctx = createMockContext();

		const sshCommand = api._registeredCommands.get("ssh");
		const grepTool = api._registeredTools.get("grep");

		// First host
		await sshCommand.handler("user@host1.com", ctx);
		await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

		// Change host
		await sshCommand.handler("user@host2.com", ctx);
		await grepTool.execute("tool-2", { pattern: "test" }, undefined, ctx, undefined);

		// Detection should happen twice (cache invalidated on host change)
		expect(detectionCalls).toBe(2);
	});
});
