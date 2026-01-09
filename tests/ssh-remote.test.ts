/**
 * Tests for pi-ssh-remote extension
 */

import {
	createMockExtensionAPI,
	createMockContext,
	extensionFn,
	mockBashExecute,
	mockCreateBashTool,
	resetAllMocks,
} from "./test-utils";

describe("pi-ssh-remote extension", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	describe("initialization", () => {
		it("should register CLI flags", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api.registerFlag).toHaveBeenCalledWith("ssh-host", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-cwd", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-port", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-command", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-timeout", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-no-mount", expect.any(Object));
			expect(api.registerFlag).toHaveBeenCalledWith("ssh-strict-host-key", expect.any(Object));
		});

		it("should register bash tool", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api._registeredTools.has("bash")).toBe(true);
		});

		it("should register session_start and session_shutdown handlers", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			expect(api.on).toHaveBeenCalledWith("session_start", expect.any(Function));
			expect(api.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
		});
	});

	describe("input validation", () => {
		it.each([
			["invalid", "Invalid SSH port: invalid"],
			["99999", "Invalid SSH port: 99999"],
			["0", "Invalid SSH port: 0"],
			["-1", "Invalid SSH port: -1"],
		])("should reject invalid port %s", async (port, expectedError) => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-port", port);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];

			await expect(handler({}, ctx)).rejects.toThrow(expectedError);
		});

		it.each([
			["notanumber", "Invalid SSH timeout: notanumber"],
			["0", "Invalid SSH timeout: 0"],
			["-5", "Invalid SSH timeout: -5"],
		])("should reject invalid timeout %s", async (timeout, expectedError) => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-timeout", timeout);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];

			await expect(handler({}, ctx)).rejects.toThrow(expectedError);
		});
	});

	describe("session_start - no ssh-host", () => {
		it("should do nothing when no ssh-host", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).not.toHaveBeenCalled();
		});
	});

	describe("session_start - with ssh-no-mount", () => {
		it("should skip mounting when ssh-no-mount is set", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");
			api._setFlag("ssh-no-mount", true);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("no auto-mount"), "info");
			expect(api.exec).not.toHaveBeenCalled();
		});
	});

	describe("session_start - auto-mount", () => {
		it("should warn when sshfs not available", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockRejectedValue(new Error("not found"));
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("SSHFS not found"), "warning");
		});

		it("should attempt to mount when sshfs is available", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Mounting"), "info");
			expect(execMock).toHaveBeenCalledWith(
				"sshfs",
				expect.arrayContaining(["user@server:/home/user"]),
				expect.any(Object)
			);
		});

		it("should include port in sshfs args", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");
			api._setFlag("ssh-port", "2222");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(execMock).toHaveBeenCalledWith("sshfs", expect.arrayContaining(["-p", "2222"]), expect.any(Object));
		});

		it("should handle mount failure gracefully", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "mount failed" }); // sshfs mount fails
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("SSHFS mount failed"), "error");
			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("bash-only"), "warning");
		});

		it("should convert ssh-command to sshfs options", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");
			api._setFlag("ssh-command", "ssh -i ~/.ssh/mykey -o ProxyJump=bastion");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			// Check that sshfs was called with converted options
			expect(execMock).toHaveBeenCalledWith(
				"sshfs",
				expect.arrayContaining(["-o", "IdentityFile=~/.ssh/mykey", "-o", "ProxyJump=bastion"]),
				expect.any(Object)
			);
		});

		it("should use StrictHostKeyChecking=accept-new by default", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(execMock).toHaveBeenCalledWith(
				"sshfs",
				expect.arrayContaining(["-o", "StrictHostKeyChecking=accept-new"]),
				expect.any(Object)
			);
		});

		it("should use StrictHostKeyChecking=yes when --ssh-strict-host-key is set", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user");
			api._setFlag("ssh-strict-host-key", true);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			expect(execMock).toHaveBeenCalledWith(
				"sshfs",
				expect.arrayContaining(["-o", "StrictHostKeyChecking=yes"]),
				expect.any(Object)
			);
			// Ensure accept-new is NOT in the args
			const sshfsCall = execMock.mock.calls.find((call: string[]) => call[0] === "sshfs");
			expect(sshfsCall).toBeDefined();
			expect(sshfsCall![1]).not.toContain("StrictHostKeyChecking=accept-new");
		});

		it("should get remote home when ssh-cwd not provided", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest
				.fn()
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // which sshfs
				.mockResolvedValueOnce({ code: 0, stdout: "/home/remoteuser\n", stderr: "" }) // echo $HOME
				.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sshfs mount
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			// No ssh-cwd set

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_start")![0];
			await handler({}, ctx);

			// Should have called ssh to get home directory
			expect(execMock).toHaveBeenCalledWith("ssh", ["user@server", "echo $HOME"], expect.any(Object));
			// Should mount the home directory
			expect(execMock).toHaveBeenCalledWith(
				"sshfs",
				expect.arrayContaining(["user@server:/home/remoteuser"]),
				expect.any(Object)
			);
		});
	});

	describe("session_shutdown - unmount", () => {
		it("should do nothing when no mount was created", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const ctx = createMockContext();
			const handler = api._eventHandlers.get("session_shutdown")![0];
			await handler({}, ctx);

			expect(ctx.ui.notify).not.toHaveBeenCalled();
		});
	});

	describe("bash tool - local execution", () => {
		it("should delegate to local bash when no ssh-host", async () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			mockBashExecute.mockResolvedValue({
				content: [{ type: "text", text: "hello" }],
				details: { exitCode: 0 },
			});

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("id", { command: "echo hello" }, undefined, ctx, undefined);

			expect(mockCreateBashTool).toHaveBeenCalledWith(ctx.cwd);
			expect(result.details.remote).toBe(false);
		});
	});

	describe("bash tool - remote execution", () => {
		it("should execute via SSH when ssh-host is set", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({
				stdout: "remote output",
				stderr: "",
				code: 0,
			});
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("ssh", ["user@server", "ls"], expect.any(Object));
			expect(result.content[0].text).toBe("remote output");
			expect(result.details.remote).toBe(true);
		});

		it("should include port when ssh-port is set", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-port", "2222");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("ssh", ["-p", "2222", "user@server", "ls"], expect.any(Object));
		});

		it("should use custom ssh command when set", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-command", "ssh -i ~/.ssh/mykey");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("ssh", ["-i", "~/.ssh/mykey", "user@server", "ls"], expect.any(Object));
		});

		it("should prepend cd when ssh-cwd is set", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-cwd", "/home/user/project");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("id", { command: "pwd" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith(
				"ssh",
				["user@server", "cd '/home/user/project' && pwd"],
				expect.any(Object)
			);
		});

		it("should apply timeout from flag", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");
			api._setFlag("ssh-timeout", "30");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(execMock).toHaveBeenCalledWith("ssh", expect.any(Array), expect.objectContaining({ timeout: 30000 }));
		});

		it("should include exit code for non-zero exit", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockResolvedValue({ stdout: "", stderr: "error", code: 1 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("id", { command: "fail" }, undefined, ctx, undefined);

			expect(result.content[0].text).toContain("[Exit code: 1]");
			expect(result.details.exitCode).toBe(1);
		});

		it("should handle SSH errors gracefully", async () => {
			const api = createMockExtensionAPI();
			const execMock = jest.fn().mockRejectedValue(new Error("Connection refused"));
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Connection refused");
		});

		it("should truncate long output", async () => {
			const api = createMockExtensionAPI();
			const longOutput = Array(3000).fill("line").join("\n");
			const execMock = jest.fn().mockResolvedValue({ stdout: longOutput, stderr: "", code: 0 });
			api._setExecMock(execMock);
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");

			const ctx = createMockContext();
			const bashTool = api._registeredTools.get("bash");
			const result = await bashTool.execute("id", { command: "ls" }, undefined, ctx, undefined);

			expect(result.content[0].text).toContain("[Output truncated:");
		});
	});

	describe("rendering", () => {
		it("should show host prefix when configured", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			api._setFlag("ssh-host", "user@server");

			const bashTool = api._registeredTools.get("bash");
			const theme = { fg: (c: string, t: string) => `[${c}]${t}[/${c}]`, dim: (t: string) => t };
			const rendered = bashTool.renderCall({ command: "ls -la" }, theme);

			expect(rendered.text).toContain("user@server");
			expect(rendered.text).toContain("ls -la");
		});

		it("should show remote indicator in result", () => {
			const api = createMockExtensionAPI();
			extensionFn(api);

			const bashTool = api._registeredTools.get("bash");
			const theme = { fg: (c: string, t: string) => `[${c}]${t}[/${c}]`, dim: (t: string) => t };
			const result = {
				content: [{ type: "text", text: "output" }],
				details: { exitCode: 0, remote: true },
			};
			const rendered = bashTool.renderResult(result, { isPartial: false }, theme);

			expect(rendered.text).toContain("🔌");
		});
	});
});
