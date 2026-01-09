/**
 * pi-ssh-remote - SSH Remote Extension for pi coding agent
 *
 * Wraps bash for remote SSH execution and auto-mounts remote filesystem via SSHFS.
 *
 * Usage:
 *   pi -e pi-ssh-remote --ssh-host user@server --ssh-cwd /path/to/project
 *
 * The extension will:
 *   1. Auto-mount the remote --ssh-cwd via SSHFS to a temp directory
 *   2. Change pi's working directory to the mount point
 *   3. Execute bash commands remotely via SSH
 *   4. Auto-unmount on session end
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerBashTool } from "./tools/bash";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SSHConfig {
	host: string | null;
	port: number | null;
	command: string | null;
	cwd: string | null;
	timeout: number | null;
	strictHostKey: boolean;
}

/**
 * Parse a string as a positive integer with validation
 */
function parsePositiveInt(value: string | undefined, name: string, options?: { max?: number }): number | null {
	if (!value) return null;
	const num = parseInt(value, 10);
	if (isNaN(num) || num < 1 || (options?.max && num > options.max)) {
		const rangeHint = options?.max ? ` Must be between 1 and ${options.max}.` : " Must be a positive number.";
		throw new Error(`Invalid ${name}: ${value}.${rangeHint}`);
	}
	return num;
}

// Track mount state for cleanup
let mountPoint: string | null = null;
let originalCwd: string | null = null;

/**
 * Reset module state (for testing)
 */
export function _resetMountState(): void {
	mountPoint = null;
	originalCwd = null;
}

export default function sshRemoteExtension(pi: ExtensionAPI): void {
	// Register CLI flags
	pi.registerFlag("ssh-host", {
		description: "SSH host for remote bash execution (e.g., user@server)",
		type: "string",
	});

	pi.registerFlag("ssh-cwd", {
		description: "Remote working directory (auto-mounted via SSHFS)",
		type: "string",
	});

	pi.registerFlag("ssh-port", {
		description: "SSH port (default: 22)",
		type: "string",
	});

	pi.registerFlag("ssh-command", {
		description: "Custom SSH command (e.g., 'ssh -i ~/.ssh/mykey')",
		type: "string",
	});

	pi.registerFlag("ssh-timeout", {
		description: "Timeout for SSH commands in seconds",
		type: "string",
	});

	pi.registerFlag("ssh-no-mount", {
		description: "Disable auto-mounting (use existing mount or manual setup)",
		type: "boolean",
	});

	pi.registerFlag("ssh-strict-host-key", {
		description: "Require known host keys (reject unknown hosts instead of auto-accepting)",
		type: "boolean",
	});

	// Build config from flags with validation
	const getConfig = (): SSHConfig => ({
		host: (pi.getFlag("ssh-host") as string) || null,
		port: parsePositiveInt(pi.getFlag("ssh-port") as string, "SSH port", { max: 65535 }),
		command: (pi.getFlag("ssh-command") as string) || null,
		cwd: (pi.getFlag("ssh-cwd") as string) || null,
		timeout: parsePositiveInt(pi.getFlag("ssh-timeout") as string, "SSH timeout"),
		strictHostKey: (pi.getFlag("ssh-strict-host-key") as boolean) || false,
	});

	// Register the SSH-wrapped bash tool
	registerBashTool(pi, getConfig);

	// Auto-mount SSHFS on session start
	pi.on("session_start", async (_event, ctx) => {
		const config = getConfig();

		if (!config.host) {
			return; // Local mode
		}

		const noMount = pi.getFlag("ssh-no-mount") as boolean;
		if (noMount) {
			ctx.ui.notify(`SSH remote: ${config.host} (no auto-mount)`, "info");
			return;
		}

		// Check if SSHFS is available
		try {
			await pi.exec("which", ["sshfs"], { timeout: 5000 });
		} catch {
			ctx.ui.notify(`SSHFS not found - install it for auto-mounting`, "warning");
			ctx.ui.notify(`SSH remote: ${config.host} (bash only, no file access)`, "info");
			return;
		}

		// Determine remote path to mount
		const remotePath = config.cwd || (await getRemoteHomePath(pi, config, ctx));
		if (!remotePath) {
			ctx.ui.notify(`Could not determine remote path to mount`, "error");
			return;
		}

		// Create temp mount point
		const tempBase = path.join(os.tmpdir(), "pi-sshfs");
		fs.mkdirSync(tempBase, { recursive: true });
		mountPoint = fs.mkdtempSync(path.join(tempBase, "mount-"));
		originalCwd = ctx.cwd;

		// Build SSHFS command
		const sshfsArgs = buildSSHFSArgs(config, remotePath, mountPoint);

		ctx.ui.notify(`Mounting ${config.host}:${remotePath}...`, "info");

		try {
			const result = await pi.exec("sshfs", sshfsArgs, { timeout: 30000 });
			if (result.code !== 0) {
				throw new Error(result.stderr || "SSHFS mount failed");
			}

			// Update pi's working directory to the mount point
			// Note: ctx.cwd is read-only, but we can change process.cwd
			// The bash tool will use the mount for local file operations
			process.chdir(mountPoint);

			ctx.ui.notify(`Mounted at ${mountPoint}`, "info");
			ctx.ui.notify(`SSH remote: ${config.host}:${remotePath}`, "info");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`SSHFS mount failed: ${message}`, "error");
			ctx.ui.notify(`Continuing with bash-only remote access`, "warning");

			// Cleanup failed mount attempt
			try {
				fs.rmdirSync(mountPoint);
			} catch {
				/* ignore */
			}
			mountPoint = null;
		}
	});

	// Auto-unmount on session shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		if (!mountPoint) return;

		ctx.ui.notify(`Unmounting ${mountPoint}...`, "info");

		try {
			// Try platform-appropriate unmount
			const unmountCmd = process.platform === "darwin" ? "diskutil" : "fusermount";
			const unmountArgs = process.platform === "darwin" ? ["unmount", "force", mountPoint] : ["-u", mountPoint];

			await pi.exec(unmountCmd, unmountArgs, { timeout: 10000 });
			ctx.ui.notify(`Unmounted`, "info");
		} catch (err) {
			// Fallback to umount
			try {
				await pi.exec("umount", [mountPoint], { timeout: 10000 });
				ctx.ui.notify(`Unmounted`, "info");
			} catch {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Unmount failed: ${message}`, "warning");
				ctx.ui.notify(`You may need to manually unmount: umount ${mountPoint}`, "warning");
			}
		}

		// Cleanup mount directory
		try {
			fs.rmdirSync(mountPoint);
		} catch {
			/* ignore */
		}

		// Restore original cwd
		if (originalCwd) {
			try {
				process.chdir(originalCwd);
			} catch {
				/* ignore */
			}
		}

		mountPoint = null;
		originalCwd = null;
	});
}

/**
 * Get the remote user's home directory path
 */
async function getRemoteHomePath(pi: ExtensionAPI, config: SSHConfig, ctx: ExtensionContext): Promise<string | null> {
	try {
		const sshArgs = buildSSHArgs(config);
		const result = await pi.exec(sshArgs[0], [...sshArgs.slice(1), "echo $HOME"], {
			timeout: 10000,
		});
		if (result.code === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Could not get remote home: ${message}`, "warning");
	}
	return null;
}

/**
 * Build SSH command arguments
 */
function buildSSHArgs(config: SSHConfig): string[] {
	const args: string[] = [];

	if (config.command) {
		args.push(...config.command.split(/\s+/));
	} else {
		args.push("ssh");
	}

	if (config.port) {
		args.push("-p", String(config.port));
	}

	args.push(config.host!);
	return args;
}

/**
 * Build SSHFS mount arguments
 */
function buildSSHFSArgs(config: SSHConfig, remotePath: string, localPath: string): string[] {
	const args: string[] = [];

	// Remote spec: user@host:/path
	args.push(`${config.host}:${remotePath}`);

	// Local mount point
	args.push(localPath);

	// Port option for SSHFS
	if (config.port) {
		args.push("-p", String(config.port));
	}

	// SSH command options (for custom keys, etc.)
	if (config.command) {
		// Extract SSH options from custom command
		// e.g., "ssh -i ~/.ssh/mykey" -> "-o IdentityFile=~/.ssh/mykey"
		const sshOpts = extractSSHOptions(config.command);
		for (const opt of sshOpts) {
			args.push("-o", opt);
		}
	}

	// Common SSHFS options
	if (config.strictHostKey) {
		args.push("-o", "StrictHostKeyChecking=yes");
	} else {
		args.push("-o", "StrictHostKeyChecking=accept-new");
	}
	args.push("-o", "reconnect");
	args.push("-o", "ServerAliveInterval=15");

	return args;
}

/**
 * Extract SSH options from a custom SSH command and convert to SSHFS format
 */
function extractSSHOptions(command: string): string[] {
	const opts: string[] = [];
	const parts = command.split(/\s+/);

	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === "-i" && parts[i + 1]) {
			opts.push(`IdentityFile=${parts[i + 1]}`);
			i++;
		} else if (parts[i] === "-o" && parts[i + 1]) {
			opts.push(parts[i + 1]);
			i++;
		}
	}

	return opts;
}
