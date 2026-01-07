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

describe("ssh-remote extension - remote tool detection (rg/fd)", () => {
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
