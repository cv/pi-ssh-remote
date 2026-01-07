/**
 * Tests for pi-ssh-remote extension
 *
 * These tests verify the core functionality of the SSH remote extension
 * by mocking the pi ExtensionAPI and simulating tool executions.
 */

// We need to extract and test the helper functions and tool logic
// Since the extension exports a single function, we'll test it through mocks

describe("ssh-remote extension", () => {
	// Mock factories
	const createMockUI = () => ({
		notify: jest.fn(),
		setStatus: jest.fn(),
		confirm: jest.fn(),
		select: jest.fn(),
		input: jest.fn(),
		editor: jest.fn(),
		custom: jest.fn(),
		setWidget: jest.fn(),
		setFooter: jest.fn(),
		setHeader: jest.fn(),
		setTitle: jest.fn(),
		setEditorText: jest.fn(),
		getEditorText: jest.fn(),
	});

	const createMockSessionManager = () => ({
		getBranch: jest.fn(() => []),
		getEntries: jest.fn(() => []),
		getLeafId: jest.fn(() => "leaf-1"),
		getLeafEntry: jest.fn(() => null),
		getSessionFile: jest.fn(() => null),
	});

	const createMockContext = () => ({
		ui: createMockUI(),
		hasUI: true,
		cwd: "/test/cwd",
		sessionManager: createMockSessionManager(),
		modelRegistry: {},
		model: {},
		isIdle: jest.fn(() => true),
		abort: jest.fn(),
		hasPendingMessages: jest.fn(() => false),
	});

	const createMockExtensionAPI = () => {
		const registeredTools: Map<string, any> = new Map();
		const registeredCommands: Map<string, any> = new Map();
		const registeredFlags: Map<string, any> = new Map();
		const eventHandlers: Map<string, ((...args: any[]) => any)[]> = new Map();
		const appendedEntries: any[] = [];
		let execMock = jest.fn();

		const api = {
			registerTool: jest.fn((tool: any) => {
				registeredTools.set(tool.name, tool);
			}),
			registerCommand: jest.fn((name: string, options: any) => {
				registeredCommands.set(name, options);
			}),
			registerFlag: jest.fn((name: string, options: any) => {
				registeredFlags.set(name, { ...options, value: undefined });
			}),
			registerShortcut: jest.fn(),
			registerMessageRenderer: jest.fn(),
			on: jest.fn((event: string, handler: (...args: any[]) => any) => {
				if (!eventHandlers.has(event)) {
					eventHandlers.set(event, []);
				}
				eventHandlers.get(event)!.push(handler);
			}),
			appendEntry: jest.fn((customType: string, data: any) => {
				appendedEntries.push({ customType, data });
			}),
			exec: jest.fn((...args: any[]) => execMock(...args)),
			getFlag: jest.fn((name: string) => registeredFlags.get(name)?.value),
			setActiveTools: jest.fn(),
			getActiveTools: jest.fn(() => ["read", "bash", "edit", "write"]),
			getAllTools: jest.fn(() => ["read", "bash", "edit", "write"]),
			sendMessage: jest.fn(),
			sendUserMessage: jest.fn(),
			events: {
				on: jest.fn(),
				emit: jest.fn(),
				off: jest.fn(),
			},
			_registeredTools: registeredTools,
			_registeredCommands: registeredCommands,
			_registeredFlags: registeredFlags,
			_eventHandlers: eventHandlers,
			_appendedEntries: appendedEntries,
			_setExecMock: (mock: jest.Mock) => {
				execMock = mock;
			},
		};

		return api;
	};

	// Import extension - use dynamic import workaround for ts-jest
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const extensionModule = require("./ssh-remote") as { default: (api: any) => void };
	const extensionFn = extensionModule.default;

	describe("initialization", () => {
		it("should register CLI flags", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api.registerFlag).toHaveBeenCalledWith(
				"ssh-host",
				expect.objectContaining({
					type: "string",
				})
			);
			expect(api.registerFlag).toHaveBeenCalledWith(
				"ssh-cwd",
				expect.objectContaining({
					type: "string",
				})
			);
			expect(api.registerFlag).toHaveBeenCalledWith(
				"ssh-timeout",
				expect.objectContaining({
					type: "string",
				})
			);
		});

		it("should register /ssh command", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api._registeredCommands.has("ssh")).toBe(true);
			expect(api._registeredCommands.get("ssh").description).toContain("SSH remote");
		});

		it("should register all seven tools", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api._registeredTools.has("bash")).toBe(true);
			expect(api._registeredTools.has("read")).toBe(true);
			expect(api._registeredTools.has("write")).toBe(true);
			expect(api._registeredTools.has("edit")).toBe(true);
			expect(api._registeredTools.has("grep")).toBe(true);
			expect(api._registeredTools.has("find")).toBe(true);
			expect(api._registeredTools.has("ls")).toBe(true);
		});

		it("should register session lifecycle handlers", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api._eventHandlers.has("session_start")).toBe(true);
			expect(api._eventHandlers.has("session_tree")).toBe(true);
			expect(api._eventHandlers.has("session_branch")).toBe(true);
		});
	});

	describe("/ssh command", () => {
		it("should show current config when called without args", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("", ctx);
			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH remote: disabled", "info");
		});

		it("should set SSH host when provided", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("user@example.com", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH remote set to: user@example.com", "info");
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("ssh-remote", expect.stringContaining("user@example.com"));
			expect(api.appendEntry).toHaveBeenCalledWith("ssh-remote-config", {
				host: "user@example.com",
				remoteCwd: null,
				port: null,
				command: null,
				timeout: null,
			});
		});

		it("should set SSH host and remote cwd when both provided", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("user@example.com /home/user/project", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH remote set to: user@example.com cwd: /home/user/project", "info");
			expect(api.appendEntry).toHaveBeenCalledWith("ssh-remote-config", {
				host: "user@example.com",
				remoteCwd: "/home/user/project",
				port: null,
				command: null,
				timeout: null,
			});
		});

		it("should disable SSH remote with 'off' command", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// First enable
			await sshCommand.handler("user@example.com", ctx);

			// Then disable
			await sshCommand.handler("off", ctx);

			expect(ctx.ui.notify).toHaveBeenLastCalledWith("SSH remote disabled", "info");
			expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("ssh-remote", undefined);
		});

		it("should set SSH port with 'port' subcommand", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("port 2222", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH port set to: 2222", "info");
			expect(api.appendEntry).toHaveBeenCalledWith(
				"ssh-remote-config",
				expect.objectContaining({
					port: 2222,
				})
			);
		});

		it("should reject invalid port numbers", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("port invalid", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Invalid port"), "error");
		});

		it("should set custom SSH command with 'command' subcommand", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("command tsh ssh", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH command set to: tsh ssh", "info");
			expect(api.appendEntry).toHaveBeenCalledWith(
				"ssh-remote-config",
				expect.objectContaining({
					command: "tsh ssh",
				})
			);
		});

		it("should include port in SSH command when configured", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "output",
				stderr: "",
				code: 0,
			});
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Configure host and port
			await sshCommand.handler("user@example.com", ctx);
			await sshCommand.handler("port 2222", ctx);

			// Execute bash command
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith(
				"ssh",
				expect.arrayContaining(["-p", "2222", "user@example.com"]),
				expect.any(Object)
			);
		});

		it("should use custom command when configured", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "output",
				stderr: "",
				code: 0,
			});
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Configure host and custom command
			await sshCommand.handler("user@example.com", ctx);
			await sshCommand.handler("command tsh ssh", ctx);

			// Execute bash command
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith(
				"tsh",
				expect.arrayContaining(["ssh", "user@example.com"]),
				expect.any(Object)
			);
		});

		it("should set SSH timeout with 'timeout' subcommand", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("timeout 120", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH timeout set to: 120 seconds", "info");
			expect(api.appendEntry).toHaveBeenCalledWith(
				"ssh-remote-config",
				expect.objectContaining({
					timeout: 120,
				})
			);
		});

		it("should reject invalid timeout values", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("timeout invalid", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Invalid timeout"), "error");
		});

		it("should show current timeout when timeout command called without args", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Set a timeout first
			await sshCommand.handler("timeout 90", ctx);

			// Clear previous calls
			(ctx.ui.notify as jest.Mock).mockClear();

			// Query current timeout
			await sshCommand.handler("timeout", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH timeout: 90 seconds", "info");
		});
	});

	describe("bash tool", () => {
		it("should execute locally when no SSH host configured", async () => {
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
			const bashTool = api._registeredTools.get("bash");

			const result = await bashTool.execute("tool-1", { command: "echo hello" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("bash", ["-c", "echo hello"], expect.any(Object));
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

		it("should include exit code in output for non-zero exit", async () => {
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
			const bashTool = api._registeredTools.get("bash");

			const result = await bashTool.execute("tool-1", { command: "nonexistent" }, undefined, ctx, undefined);

			expect(result.content[0].text).toContain("[Exit code: 127]");
			expect(result.details.exitCode).toBe(127);
		});
	});

	describe("read tool", () => {
		it("should read file locally when no SSH host configured", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "file content here",
				stderr: "",
				code: 0,
				killed: false,
			});
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();
			const readTool = api._registeredTools.get("read");

			const result = await readTool.execute("tool-1", { path: "test.txt" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("cat", ["test.txt"], expect.any(Object));
			expect(result.content[0].text).toBe("file content here");
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

			expect(execMock).toHaveBeenCalledWith(
				"ssh",
				["user@server.com", "sed -n '10,12p' 'test.txt'"],
				expect.any(Object)
			);
		});
	});

	describe("write tool", () => {
		it("should write file locally when no SSH host configured", async () => {
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
			const writeTool = api._registeredTools.get("write");

			const content = "hello world";
			const result = await writeTool.execute("tool-1", { path: "test.txt", content }, undefined, ctx, undefined);

			// Should create directory first
			expect(execMock).toHaveBeenCalledWith("bash", ["-c", expect.stringContaining("mkdir -p")], expect.any(Object));
			expect(result.content[0].text).toContain("Successfully wrote");
			expect(result.details.bytes).toBe(content.length);
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
	});

	describe("edit tool", () => {
		it("should edit file locally when no SSH host configured", async () => {
			const api = createMockExtensionAPI();
			let callCount = 0;
			const execMock = jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// Read
					return Promise.resolve({
						stdout: "hello world",
						stderr: "",
						code: 0,
						killed: false,
					});
				}
				// Write
				return Promise.resolve({
					stdout: "",
					stderr: "",
					code: 0,
					killed: false,
				});
			});
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();
			const editTool = api._registeredTools.get("edit");

			const result = await editTool.execute(
				"tool-1",
				{ path: "test.txt", oldText: "hello", newText: "goodbye" },
				undefined,
				ctx,
				undefined
			);

			expect(result.content[0].text).toContain("Successfully edited");
			expect(result.details.remote).toBe(false);
		});

		it("should fail when oldText is not found", async () => {
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

		it("should fail when oldText appears multiple times", async () => {
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
	});

	describe("grep tool", () => {
		it("should execute grep locally when SSH is not configured", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "file.txt:1:matching line\n",
				stderr: "",
				code: 0,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const grepTool = api._registeredTools.get("grep");

			const result = await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

			expect(api.exec).toHaveBeenCalledWith("bash", expect.arrayContaining(["-c"]), expect.any(Object));
			expect(result.content[0].text).toContain("matching line");
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

		it("should return 'No matches found' when grep finds nothing", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "",
				stderr: "",
				code: 1,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const grepTool = api._registeredTools.get("grep");

			const result = await grepTool.execute("tool-1", { pattern: "nonexistent" }, undefined, ctx, undefined);

			expect(result.content[0].text).toBe("No matches found");
		});
	});

	describe("find tool", () => {
		it("should execute find locally when SSH is not configured", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "./src/file.ts\n./lib/other.ts\n",
				stderr: "",
				code: 0,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const findTool = api._registeredTools.get("find");

			const result = await findTool.execute("tool-1", { pattern: "*.ts" }, undefined, ctx, undefined);

			expect(api.exec).toHaveBeenCalledWith("bash", expect.arrayContaining(["-c"]), expect.any(Object));
			expect(result.content[0].text).toContain("file.ts");
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

		it("should return 'No files found' when find finds nothing", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "",
				stderr: "",
				code: 0,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const findTool = api._registeredTools.get("find");

			const result = await findTool.execute("tool-1", { pattern: "*.nonexistent" }, undefined, ctx, undefined);

			expect(result.content[0].text).toBe("No files found matching pattern");
		});
	});

	describe("remote tool detection (rg/fd)", () => {
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

	describe("ls tool", () => {
		it("should execute ls locally when SSH is not configured", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "file1.txt\nfile2.txt\ndir1\n",
				stderr: "",
				code: 0,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const lsTool = api._registeredTools.get("ls");

			const result = await lsTool.execute("tool-1", {}, undefined, ctx, undefined);

			expect(api.exec).toHaveBeenCalledWith("bash", expect.arrayContaining(["-c"]), expect.any(Object));
			expect(result.content[0].text).toContain("file1.txt");
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

		it("should return '(empty directory)' for empty directories", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "",
				stderr: "",
				code: 0,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const lsTool = api._registeredTools.get("ls");

			const result = await lsTool.execute("tool-1", { path: "/empty" }, undefined, ctx, undefined);

			expect(result.content[0].text).toBe("(empty directory)");
		});

		it("should handle ls errors", async () => {
			const api = createMockExtensionAPI();
			(api.exec as jest.Mock).mockResolvedValue({
				stdout: "",
				stderr: "No such file or directory",
				code: 2,
			});

			extensionFn(api);
			const ctx = createMockContext();
			const lsTool = api._registeredTools.get("ls");

			const result = await lsTool.execute("tool-1", { path: "/nonexistent" }, undefined, ctx, undefined);

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("session state persistence", () => {
		it("should restore state from session on session_start", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			(ctx.sessionManager.getBranch as jest.Mock).mockReturnValue([
				{
					type: "custom",
					customType: "ssh-remote-config",
					data: {
						host: "restored@host.com",
						remoteCwd: "/restored/path",
					},
				},
			]);

			// Trigger session_start
			const handlers = api._eventHandlers.get("session_start")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			expect(ctx.ui.setStatus).toHaveBeenCalledWith("ssh-remote", expect.stringContaining("restored@host.com"));
		});

		it("should use CLI flags over session state", async () => {
			const api = createMockExtensionAPI();

			extensionFn(api);

			// Set CLI flag values after extension registers them but before session_start
			api._registeredFlags.get("ssh-host")!.value = "cli@host.com";
			api._registeredFlags.get("ssh-cwd")!.value = "/cli/path";

			const ctx = createMockContext();
			(ctx.sessionManager.getBranch as jest.Mock).mockReturnValue([
				{
					type: "custom",
					customType: "ssh-remote-config",
					data: {
						host: "session@host.com",
						remoteCwd: "/session/path",
					},
				},
			]);

			// Trigger session_start
			const handlers = api._eventHandlers.get("session_start")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			// Should use CLI host, not session host
			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("cli@host.com"), "info");
		});
	});

	describe("shell escaping", () => {
		it("should escape single quotes in paths", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "content",
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
			await readTool.execute("tool-1", { path: "file's name.txt" }, undefined, ctx, undefined);

			// Should escape the single quote
			expect(execMock).toHaveBeenCalledWith(
				"ssh",
				["user@server.com", "cat 'file'\\''s name.txt'"],
				expect.any(Object)
			);
		});
	});

	describe("render functions", () => {
		it("should render bash call with SSH prefix when configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");
			await sshCommand.handler("user@server.com", ctx);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				bold: (text: string) => `**${text}**`,
			};

			const rendered = bashTool.renderCall({ command: "ls -la" }, mockTheme);
			expect(rendered.text).toContain("user@server.com");
			expect(rendered.text).toContain("ls -la");
		});

		it("should render bash result with remote prefix", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				bold: (text: string) => `**${text}**`,
				dim: (text: string) => `~${text}~`,
			};

			const result = {
				content: [{ type: "text", text: "output line 1\noutput line 2" }],
				details: { exitCode: 0, remote: true },
			};

			const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("[remote]");
			expect(rendered.text).toContain("output line 1");
		});

		it("should render partial bash result as 'Running...'", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "" }],
				details: {},
			};

			const rendered = bashTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
			expect(rendered.text).toContain("Running...");
		});

		it("should render write result with byte count", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const writeTool = api._registeredTools.get("write");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				bold: (text: string) => `**${text}**`,
			};

			const result = {
				content: [{ type: "text", text: "Success" }],
				details: { bytes: 1024, remote: true },
			};

			const rendered = writeTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("1024");
			expect(rendered.text).toContain("[remote]");
		});

		it("should render edit result with line delta", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const editTool = api._registeredTools.get("edit");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				bold: (text: string) => `**${text}**`,
			};

			const result = {
				content: [{ type: "text", text: "Success" }],
				details: { lineDelta: 5, remote: true },
			};

			const rendered = editTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("+5");
			expect(rendered.text).toContain("[remote]");
		});
	});

	describe("error handling", () => {
		it("should handle bash execution errors", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockRejectedValue(new Error("Connection refused"));
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");

			const result = await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Connection refused");
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

		it("should handle edit read errors", async () => {
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

		it("should handle edit write errors", async () => {
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

		it("should render error results correctly", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const writeTool = api._registeredTools.get("write");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "Permission denied" }],
				details: { error: "Permission denied" },
				isError: true,
			};

			const rendered = writeTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("Permission denied");
			expect(rendered.text).toContain("[error]");
		});
	});

	describe("edge cases", () => {
		it("should handle timeout parameter in bash", async () => {
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
			const bashTool = api._registeredTools.get("bash");

			await bashTool.execute("tool-1", { command: "sleep 10", timeout: 5 }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("bash", ["-c", "sleep 10"], expect.objectContaining({ timeout: 5000 }));
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

			expect(execMock).toHaveBeenCalledWith(
				"ssh",
				["user@server.com", "sed -n '50,$p' 'test.txt'"],
				expect.any(Object)
			);
		});

		it("should show current SSH config with cwd", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Set host with cwd
			await sshCommand.handler("user@server.com /home/user", ctx);

			// Clear mock
			(ctx.ui.notify as jest.Mock).mockClear();

			// Query current config
			await sshCommand.handler("", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH remote: user@server.com cwd: /home/user", "info");
		});

		it("should restore state on session_tree event", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			(ctx.sessionManager.getBranch as jest.Mock).mockReturnValue([
				{
					type: "custom",
					customType: "ssh-remote-config",
					data: {
						host: "tree@host.com",
						remoteCwd: "/tree/path",
					},
				},
			]);

			// Trigger session_tree
			const handlers = api._eventHandlers.get("session_tree")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			expect(ctx.ui.setStatus).toHaveBeenCalledWith("ssh-remote", expect.stringContaining("tree@host.com"));
		});

		it("should restore state on session_branch event", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			(ctx.sessionManager.getBranch as jest.Mock).mockReturnValue([
				{
					type: "custom",
					customType: "ssh-remote-config",
					data: {
						host: "branch@host.com",
						remoteCwd: null,
					},
				},
			]);

			// Trigger session_branch
			const handlers = api._eventHandlers.get("session_branch")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			expect(ctx.ui.setStatus).toHaveBeenCalledWith("ssh-remote", expect.stringContaining("branch@host.com"));
		});

		it("should handle bash output truncation", async () => {
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
			const bashTool = api._registeredTools.get("bash");

			const result = await bashTool.execute("tool-1", { command: "cat bigfile" }, undefined, ctx, undefined);

			expect(result.content[0].text).toContain("[Output truncated:");
			expect(result.details.truncation).toBeDefined();
		});

		it("should handle read output truncation", async () => {
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

		it("should render bash result with non-zero exit code", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				dim: (text: string) => `~${text}~`,
			};

			const result = {
				content: [{ type: "text", text: "error output" }],
				details: { exitCode: 1, remote: false },
			};

			const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("[exit: 1]");
			expect(rendered.text).toContain("[error]");
		});

		it("should render bash result with error in details", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "" }],
				details: { error: "Connection timeout" },
			};

			const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("Connection timeout");
		});

		it("should render bash result with many lines (truncated display)", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
				dim: (text: string) => `~${text}~`,
			};

			// Generate more than 10 lines
			const manyLines = Array(15)
				.fill(0)
				.map((_, i) => `line ${i}`)
				.join("\n");
			const result = {
				content: [{ type: "text", text: manyLines }],
				details: { exitCode: 0, remote: false },
			};

			const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("[dim]...[/dim]"); // Should show truncation indicator
		});

		it("should render read call without SSH prefix when not configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const readTool = api._registeredTools.get("read");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const rendered = readTool.renderCall({ path: "test.txt" }, mockTheme);
			// When not configured, there's no [accent] prefix for the host
			expect(rendered.text).not.toContain("[accent]");
			expect(rendered.text).toContain("read test.txt");
		});

		it("should render write call without SSH prefix when not configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const writeTool = api._registeredTools.get("write");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const rendered = writeTool.renderCall({ path: "test.txt" }, mockTheme);
			expect(rendered.text).toContain("write test.txt");
		});

		it("should render edit call without SSH prefix when not configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const editTool = api._registeredTools.get("edit");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const rendered = editTool.renderCall({ path: "test.txt" }, mockTheme);
			expect(rendered.text).toContain("edit test.txt");
		});

		it("should render edit result as partial (Editing...)", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const editTool = api._registeredTools.get("edit");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "" }],
				details: {},
			};

			const rendered = editTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
			expect(rendered.text).toContain("Editing...");
		});

		it("should render write result as partial (Writing...)", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const writeTool = api._registeredTools.get("write");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "" }],
				details: {},
			};

			const rendered = writeTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
			expect(rendered.text).toContain("Writing...");
		});

		it("should render edit error result", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const editTool = api._registeredTools.get("edit");
			const mockTheme = {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			};

			const result = {
				content: [{ type: "text", text: "oldText not found" }],
				details: { error: "not found" },
				isError: true,
			};

			const rendered = editTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
			expect(rendered.text).toContain("oldText not found");
			expect(rendered.text).toContain("[error]");
		});

		it("should handle edit with negative line delta", async () => {
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
});
