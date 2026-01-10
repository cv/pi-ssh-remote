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
import { buildSSHArgs, extractSSHOptions } from "./utils/ssh";
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

	const getConfig = (): SSHConfig => ({
		host: (pi.getFlag("ssh-host") as string) || null,
		port: parsePositiveInt(pi.getFlag("ssh-port") as string, "SSH port", { max: 65535 }),
		command: (pi.getFlag("ssh-command") as string) || null,
		cwd: (pi.getFlag("ssh-cwd") as string) || null,
		timeout: parsePositiveInt(pi.getFlag("ssh-timeout") as string, "SSH timeout"),
		strictHostKey: (pi.getFlag("ssh-strict-host-key") as boolean) || false,
	});

	registerBashTool(pi, getConfig);

	pi.on("session_start", async (_event, ctx) => {
		const config = getConfig();

		if (!config.host) {
			return;
		}

		const noMount = pi.getFlag("ssh-no-mount") as boolean;
		if (noMount) {
			ctx.ui.notify(`SSH remote: ${config.host} (no auto-mount)`, "info");
			return;
		}

		// Detect print mode (-p flag) - in print mode, pi captures cwd before session_start
		// so auto-mount won't work correctly for file tools
		const isPrintMode = process.argv.includes("-p") || process.argv.includes("--print");
		if (isPrintMode) {
			ctx.ui.notify(`⚠️  Print mode detected. Auto-mount may not work correctly for file tools.`, "warning");
			ctx.ui.notify(`Use --ssh-no-mount with pre-mounted SSHFS, or use bash commands for file access.`, "info");
		}

		try {
			await pi.exec("which", ["sshfs"], { timeout: 5000 });
		} catch {
			ctx.ui.notify(`SSHFS not found - install it for auto-mounting`, "warning");
			ctx.ui.notify(`SSH remote: ${config.host} (bash only)`, "info");
			ctx.ui.notify(`⚠️  File tools (read/write/edit) will operate on LOCAL files, not remote!`, "warning");
			return;
		}

		const remotePath = config.cwd || (await getRemoteHomePath(pi, config, ctx));
		if (!remotePath) {
			ctx.ui.notify(`Could not determine remote path to mount`, "error");
			return;
		}

		const tempBase = path.join(os.tmpdir(), "pi-sshfs");
		fs.mkdirSync(tempBase, { recursive: true });
		mountPoint = fs.mkdtempSync(path.join(tempBase, "mount-"));
		originalCwd = ctx.cwd;

		const sshfsArgs = buildSSHFSArgs(config, remotePath, mountPoint);

		ctx.ui.notify(`Mounting ${config.host}:${remotePath}...`, "info");

		try {
			const result = await pi.exec("sshfs", sshfsArgs, { timeout: SSHFS_MOUNT_TIMEOUT });
			if (result.code !== 0) {
				throw new Error(result.stderr || "SSHFS mount failed");
			}

			try {
				process.chdir(mountPoint);
			} catch (chdirErr) {
				const chdirMessage = chdirErr instanceof Error ? chdirErr.message : String(chdirErr);
				ctx.ui.notify(`Failed to change to mount directory: ${chdirMessage}`, "error");
				await unmountSSHFS(pi, mountPoint).catch(() => {});
				try {
					fs.rmdirSync(mountPoint);
				} catch {
					// Cleanup is best-effort
				}
				mountPoint = null;
				throw chdirErr;
			}

			ctx.ui.notify(`Mounted at ${mountPoint}`, "info");
			ctx.ui.notify(`SSH remote: ${config.host}:${remotePath}`, "info");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`SSHFS mount failed: ${message}`, "error");
			ctx.ui.notify(`Continuing with bash-only remote access`, "warning");
			ctx.ui.notify(`⚠️  File tools (read/write/edit) will operate on LOCAL files, not remote!`, "warning");

			try {
				fs.rmdirSync(mountPoint);
			} catch {
				// Cleanup is best-effort
			}
			mountPoint = null;
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const currentMountPoint = mountPoint;
		const currentOriginalCwd = originalCwd;
		mountPoint = null;
		originalCwd = null;

		if (!currentMountPoint) return;

		ctx.ui.notify(`Unmounting ${currentMountPoint}...`, "info");

		try {
			await unmountSSHFS(pi, currentMountPoint);
			ctx.ui.notify(`Unmounted`, "info");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Unmount failed: ${message}`, "warning");
			ctx.ui.notify(`You may need to manually unmount: umount ${currentMountPoint}`, "warning");
		}

		try {
			fs.rmdirSync(currentMountPoint);
		} catch {
			// Cleanup is best-effort
		}

		if (currentOriginalCwd) {
			try {
				process.chdir(currentOriginalCwd);
			} catch {
				// Restoration is best-effort
			}
		}
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

/** Timeout for SSHFS mount operation in milliseconds */
const SSHFS_MOUNT_TIMEOUT = 30000;

/**
 * Build SSHFS mount arguments
 */
function buildSSHFSArgs(config: SSHConfig, remotePath: string, localPath: string): string[] {
	const args: string[] = [];

	args.push(`${config.host}:${remotePath}`);
	args.push(localPath);

	if (config.port) {
		args.push("-p", String(config.port));
	}

	if (config.command) {
		const sshOpts = extractSSHOptions(config.command);
		for (const opt of sshOpts) {
			args.push("-o", opt);
		}
	}

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
 * Unmount SSHFS mount point
 */
async function unmountSSHFS(pi: ExtensionAPI, mountPath: string): Promise<void> {
	const unmountCmd = process.platform === "darwin" ? "diskutil" : "fusermount";
	const unmountArgs = process.platform === "darwin" ? ["unmount", "force", mountPath] : ["-u", mountPath];

	try {
		await pi.exec(unmountCmd, unmountArgs, { timeout: 10000 });
	} catch {
		await pi.exec("umount", [mountPath], { timeout: 10000 });
	}
}
