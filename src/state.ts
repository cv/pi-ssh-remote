/**
 * SSH state management for pi-ssh-remote extension
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SSHConfig, SSHState, SSHExecOptions, SSHExecResult, RemoteToolsCache } from "./types";

export function createSSHState(pi: ExtensionAPI): SSHState {
	// Current SSH configuration
	let sshHost: string | null = null;
	let remoteCwd: string | null = null;
	let sshPort: number | null = null;
	let sshCommand: string | null = null;
	let sshTimeout: number | null = null;

	// Cache for remote tool availability
	let remoteToolsCache: RemoteToolsCache | null = null;

	// Helper to safely extract error message from unknown error type
	function getErrorMessage(err: unknown): string {
		if (err instanceof Error) {
			return err.message;
		}
		return String(err);
	}

	// Helper to escape shell arguments for SSH
	function escapeForShell(str: string): string {
		return "'" + str.replace(/'/g, "'\\''") + "'";
	}

	// Helper to build SSH command prefix
	function sshPrefix(): string[] {
		if (!sshHost) return [];

		if (sshCommand) {
			const parts = sshCommand.split(/\s+/);
			if (sshPort) {
				return [...parts, "-p", String(sshPort), sshHost];
			}
			return [...parts, sshHost];
		}

		if (sshPort) {
			return ["ssh", "-p", String(sshPort), sshHost];
		}
		return ["ssh", sshHost];
	}

	// Helper to build remote command with optional cd
	function buildRemoteCommand(command: string): string {
		if (remoteCwd) {
			return `cd ${escapeForShell(remoteCwd)} && ${command}`;
		}
		return command;
	}

	// Get effective timeout (CLI flag takes precedence over config)
	function getEffectiveTimeout(): number | undefined {
		const cliTimeout = pi.getFlag("ssh-timeout") as string | undefined;
		if (cliTimeout) {
			const parsed = parseInt(cliTimeout, 10);
			if (!isNaN(parsed) && parsed > 0) {
				return parsed;
			}
		}
		if (sshTimeout && sshTimeout > 0) {
			return sshTimeout;
		}
		return undefined;
	}

	// Helper to execute SSH command with standard options
	async function sshExec(remoteCmd: string, options: SSHExecOptions): Promise<SSHExecResult> {
		const prefix = sshPrefix();
		const effectiveTimeout = options.timeout ?? getEffectiveTimeout();
		return pi.exec(prefix[0], [...prefix.slice(1), remoteCmd], {
			signal: options.signal,
			timeout: effectiveTimeout ? effectiveTimeout * 1000 : undefined,
			cwd: options.cwd,
		});
	}

	// Helper to validate port number
	function isValidPort(port: number): boolean {
		return !isNaN(port) && port >= 1 && port <= 65535;
	}

	// Detect available tools on remote host (rg, fd)
	async function detectRemoteTools(ctx: ExtensionContext): Promise<RemoteToolsCache> {
		if (!sshHost) {
			return { host: "", hasRg: false, hasFd: false };
		}

		if (remoteToolsCache && remoteToolsCache.host === sshHost) {
			return remoteToolsCache;
		}

		const detectCmd =
			"command -v rg >/dev/null 2>&1 && echo 'rg:yes' || echo 'rg:no'; command -v fd >/dev/null 2>&1 && echo 'fd:yes' || echo 'fd:no'";
		const prefix = sshPrefix();

		try {
			const result = await pi.exec(prefix[0], [...prefix.slice(1), detectCmd], {
				cwd: ctx.cwd,
			});

			const output = result.stdout;
			const hasRg = output.includes("rg:yes");
			const hasFd = output.includes("fd:yes");

			remoteToolsCache = { host: sshHost, hasRg, hasFd };
			return remoteToolsCache;
		} catch {
			remoteToolsCache = { host: sshHost, hasRg: false, hasFd: false };
			return remoteToolsCache;
		}
	}

	// Invalidate tools cache
	function invalidateToolsCache() {
		remoteToolsCache = null;
	}

	// Persist current state
	function persistState() {
		pi.appendEntry<SSHConfig>("ssh-remote-config", {
			host: sshHost,
			remoteCwd: remoteCwd,
			port: sshPort,
			command: sshCommand,
			timeout: sshTimeout,
		});
	}

	// Update status line
	function updateStatus(ctx: ExtensionContext) {
		if (sshHost) {
			const portInfo = sshPort ? `:${sshPort}` : "";
			const cwdInfo = remoteCwd ? ` (${remoteCwd})` : "";
			const cmdInfo = sshCommand ? ` [${sshCommand.split(" ")[0]}]` : "";
			const timeoutInfo = sshTimeout ? ` ⏱${sshTimeout}s` : "";
			ctx.ui.setStatus("ssh-remote", `🔗 SSH: ${sshHost}${portInfo}${cwdInfo}${cmdInfo}${timeoutInfo}`);
		} else {
			ctx.ui.setStatus("ssh-remote", undefined);
		}
	}

	// Restore state from session
	function restoreFromBranch(ctx: ExtensionContext) {
		const branchEntries = ctx.sessionManager.getBranch();

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "ssh-remote-config") {
				const data = entry.data as SSHConfig | undefined;
				if (data) {
					sshHost = data.host;
					remoteCwd = data.remoteCwd;
					sshPort = data.port;
					sshCommand = data.command;
					sshTimeout = data.timeout;
				}
			}
		}

		updateStatus(ctx);
	}

	return {
		// Getters
		getHost: () => sshHost,
		getRemoteCwd: () => remoteCwd,
		getPort: () => sshPort,
		getCommand: () => sshCommand,
		getTimeout: () => sshTimeout,

		// Setters
		setHost: (host) => {
			sshHost = host;
		},
		setRemoteCwd: (cwd) => {
			remoteCwd = cwd;
		},
		setPort: (port) => {
			sshPort = port;
		},
		setCommand: (command) => {
			sshCommand = command;
		},
		setTimeout: (timeout) => {
			sshTimeout = timeout;
		},

		// Helpers
		escapeForShell,
		buildRemoteCommand,
		sshPrefix,
		sshExec,
		getEffectiveTimeout,
		detectRemoteTools,
		invalidateToolsCache,
		isValidPort,
		getErrorMessage,

		// State management
		persistState,
		updateStatus,
		restoreFromBranch,

		// Extension API access
		pi,
	};
}
