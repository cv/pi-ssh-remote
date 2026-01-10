/**
 * Tests for shared SSH utilities
 */

import { buildSSHArgs, extractSSHOptions, escapePath } from "../src/utils/ssh";
import type { SSHConfig } from "../src/index";

describe("SSH utilities", () => {
	describe("buildSSHArgs", () => {
		it("should use default ssh command when no custom command", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: null,
				command: null,
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			const args = buildSSHArgs(config);
			expect(args).toEqual(["ssh", "user@server"]);
		});

		it("should include port when specified", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: 2222,
				command: null,
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			const args = buildSSHArgs(config);
			expect(args).toEqual(["ssh", "-p", "2222", "user@server"]);
		});

		it("should parse custom ssh command", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: null,
				command: "ssh -i ~/.ssh/mykey",
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			const args = buildSSHArgs(config);
			expect(args).toEqual(["ssh", "-i", "~/.ssh/mykey", "user@server"]);
		});

		it("should handle quoted arguments in custom command", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: null,
				command: 'ssh -o "ProxyCommand ssh -W %h:%p bastion"',
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			const args = buildSSHArgs(config);
			expect(args).toEqual(["ssh", "-o", "ProxyCommand ssh -W %h:%p bastion", "user@server"]);
		});

		it("should reject shell operators in custom command", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: null,
				command: "ssh | cat",
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			expect(() => buildSSHArgs(config)).toThrow(/shell operators.*not allowed/);
		});

		it("should provide helpful error message for invalid command", () => {
			const config: SSHConfig = {
				host: "user@server",
				port: null,
				command: "ssh > /tmp/log",
				cwd: null,
				timeout: null,
				strictHostKey: false,
			};

			expect(() => buildSSHArgs(config)).toThrow(/ssh -i ~\/.ssh\/mykey/);
		});
	});

	describe("extractSSHOptions", () => {
		it("should extract identity file option", () => {
			const opts = extractSSHOptions("ssh -i ~/.ssh/mykey");
			expect(opts).toEqual(["IdentityFile=~/.ssh/mykey"]);
		});

		it("should extract -o options", () => {
			const opts = extractSSHOptions("ssh -o ProxyJump=bastion");
			expect(opts).toEqual(["ProxyJump=bastion"]);
		});

		it("should extract multiple options", () => {
			const opts = extractSSHOptions("ssh -i ~/.ssh/mykey -o ProxyJump=bastion -o StrictHostKeyChecking=no");
			expect(opts).toEqual(["IdentityFile=~/.ssh/mykey", "ProxyJump=bastion", "StrictHostKeyChecking=no"]);
		});

		it("should handle quoted -o values", () => {
			const opts = extractSSHOptions('ssh -o "ProxyCommand ssh -W %h:%p bastion"');
			expect(opts).toEqual(["ProxyCommand ssh -W %h:%p bastion"]);
		});

		it("should return empty array for command without options", () => {
			const opts = extractSSHOptions("ssh");
			expect(opts).toEqual([]);
		});
	});

	describe("escapePath", () => {
		it("should escape single quotes", () => {
			const escaped = escapePath("/path/with'quote");
			expect(escaped).toBe("/path/with'\\''quote");
		});

		it("should handle paths without special characters", () => {
			const escaped = escapePath("/home/user/project");
			expect(escaped).toBe("/home/user/project");
		});

		it("should handle multiple single quotes", () => {
			const escaped = escapePath("it's a path's thing");
			expect(escaped).toBe("it'\\''s a path'\\''s thing");
		});

		it("should reject paths with null bytes", () => {
			expect(() => escapePath("/path/with\0null")).toThrow(/null byte/);
		});

		it("should reject paths with newlines", () => {
			expect(() => escapePath("/path/with\nnewline")).toThrow(/newline/);
		});

		it("should reject paths with carriage returns", () => {
			expect(() => escapePath("/path/with\rcarriage")).toThrow(/newline/);
		});
	});
});
