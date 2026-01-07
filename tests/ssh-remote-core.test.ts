/**
 * Core tests for pi-ssh-remote extension
 * Tests initialization, /ssh command, session state, and shell escaping
 */

import { createMockExtensionAPI, createMockContext, extensionFn } from "./test-utils";

describe("ssh-remote extension - core", () => {
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

		it("should set SSH cwd with 'cwd' subcommand", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("cwd /workspaces/myproject", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH working directory set to: /workspaces/myproject", "info");
			expect(api.appendEntry).toHaveBeenCalledWith(
				"ssh-remote-config",
				expect.objectContaining({
					remoteCwd: "/workspaces/myproject",
				})
			);
		});

		it("should show current cwd when cwd command called without args", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Set cwd first
			await sshCommand.handler("cwd /workspaces/myproject", ctx);

			// Clear previous calls
			(ctx.ui.notify as jest.Mock).mockClear();

			// Query current cwd
			await sshCommand.handler("cwd", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH working directory: /workspaces/myproject", "info");
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

	describe("/ssh command edge cases", () => {
		it("should show 'ssh (default)' when querying command with no custom command set", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Query command without setting one first
			await sshCommand.handler("command", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH command: ssh (default)", "info");
		});

		it("should show current command when querying after setting custom command", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Set a custom command first
			await sshCommand.handler("command tsh ssh", ctx);

			// Clear mocks
			(ctx.ui.notify as jest.Mock).mockClear();

			// Query command
			await sshCommand.handler("command", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH command: tsh ssh", "info");
		});

		it("should show 'not set' when querying timeout with no timeout configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Query timeout without setting one first
			await sshCommand.handler("timeout", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH timeout: not set (no default timeout)", "info");
		});

		it("should show 'not set' when querying cwd with no cwd configured", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			// Query cwd without setting one first
			await sshCommand.handler("cwd", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("SSH working directory: not set", "info");
		});

		it("should reject negative timeout values", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("timeout -5", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid timeout number. Use: /ssh timeout <seconds>", "error");
		});

		it("should reject zero timeout value", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const sshCommand = api._registeredCommands.get("ssh");

			await sshCommand.handler("timeout 0", ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid timeout number. Use: /ssh timeout <seconds>", "error");
		});
	});

	describe("CLI flag validation", () => {
		it("should warn about invalid port from CLI flag", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			// Set invalid port via CLI flag
			api._registeredFlags.get("ssh-host")!.value = "user@host.com";
			api._registeredFlags.get("ssh-port")!.value = "99999";

			const ctx = createMockContext();

			// Trigger session_start
			const handlers = api._eventHandlers.get("session_start")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			expect(ctx.ui.notify).toHaveBeenCalledWith(
				"Invalid SSH port '99999' ignored. Use a value between 1-65535.",
				"warning"
			);
		});

		it("should warn about non-numeric port from CLI flag", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			// Set non-numeric port via CLI flag
			api._registeredFlags.get("ssh-host")!.value = "user@host.com";
			api._registeredFlags.get("ssh-port")!.value = "abc";

			const ctx = createMockContext();

			// Trigger session_start
			const handlers = api._eventHandlers.get("session_start")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			expect(ctx.ui.notify).toHaveBeenCalledWith(
				"Invalid SSH port 'abc' ignored. Use a value between 1-65535.",
				"warning"
			);
		});

		it("should use custom command with port from CLI flags", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "output",
				stderr: "",
				code: 0,
			});
			api._setExecMock(execMock);
			extensionFn(api);

			// Set CLI flags including custom command and port
			api._registeredFlags.get("ssh-host")!.value = "user@host.com";
			api._registeredFlags.get("ssh-port")!.value = "2222";
			api._registeredFlags.get("ssh-command")!.value = "tsh ssh";

			const ctx = createMockContext();

			// Trigger session_start
			const handlers = api._eventHandlers.get("session_start")!;
			for (const handler of handlers) {
				await handler({}, ctx);
			}

			// Execute bash command to verify the SSH prefix
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

			// Should use custom command with port
			expect(execMock).toHaveBeenCalledWith(
				"tsh",
				expect.arrayContaining(["ssh", "-p", "2222", "user@host.com"]),
				expect.any(Object)
			);
		});
	});

	describe("error message handling", () => {
		it("should handle non-Error objects in catch blocks", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockRejectedValue("string error");
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();

			// Configure SSH
			const sshCommand = api._registeredCommands.get("ssh");
			await sshCommand.handler("user@server.com", ctx);

			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("tool-1", { command: "ls" }, undefined, ctx, undefined);

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("string error");
		});
	});

	describe("remote tool detection edge cases", () => {
		it("should handle detection command failure gracefully", async () => {
			const api = createMockExtensionAPI();
			let callCount = 0;
			const execMock = jest.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// Detection fails
					return Promise.reject(new Error("Connection refused"));
				}
				// Subsequent calls succeed
				return Promise.resolve({ stdout: "result\n", stderr: "", code: 0 });
			});
			api._setExecMock(execMock);
			extensionFn(api);

			const ctx = createMockContext();

			// Configure SSH
			const sshCommand = api._registeredCommands.get("ssh");
			await sshCommand.handler("user@server.com", ctx);

			const grepTool = api._registeredTools.get("grep");
			await grepTool.execute("tool-1", { pattern: "test" }, undefined, ctx, undefined);

			// Should fall back to grep (not rg) and still work
			const calls = execMock.mock.calls;
			const grepCall = calls[1];
			expect(grepCall[1].some((arg: string) => arg.includes("grep "))).toBe(true);
		});
	});
});
