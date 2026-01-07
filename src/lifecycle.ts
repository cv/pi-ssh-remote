/**
 * Session lifecycle handlers for pi-ssh-remote extension
 */

import type { SSHState } from "./types";

export function registerLifecycleHandlers(state: SSHState): void {
	const pi = state.pi;

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		// Check for CLI flags first (they take precedence over session state)
		const cliHost = pi.getFlag("ssh-host") as string | undefined;
		const cliCwd = pi.getFlag("ssh-cwd") as string | undefined;
		const cliPort = pi.getFlag("ssh-port") as string | undefined;
		const cliCommand = pi.getFlag("ssh-command") as string | undefined;
		const cliTimeout = pi.getFlag("ssh-timeout") as string | undefined;

		if (cliHost) {
			state.setHost(cliHost);
			state.setRemoteCwd(cliCwd || null);

			// Validate port from CLI flag
			if (cliPort) {
				const parsedPort = parseInt(cliPort, 10);
				if (state.isValidPort(parsedPort)) {
					state.setPort(parsedPort);
				} else {
					state.setPort(null);
					ctx.ui.notify(`Invalid SSH port '${cliPort}' ignored. Use a value between 1-65535.`, "warning");
				}
			} else {
				state.setPort(null);
			}

			state.setCommand(cliCommand || null);
			state.setTimeout(cliTimeout ? parseInt(cliTimeout, 10) : null);
			state.invalidateToolsCache();
			state.persistState();
			state.updateStatus(ctx);

			const port = state.getPort();
			const cwd = state.getRemoteCwd();
			const command = state.getCommand();
			const timeout = state.getTimeout();
			const portInfo = port ? `:${port}` : "";
			const cwdInfo = cwd ? ` (${cwd})` : "";
			const cmdInfo = command ? ` via ${command}` : "";
			const timeoutInfo = timeout ? ` timeout: ${timeout}s` : "";
			ctx.ui.notify(`SSH remote configured via CLI: ${cliHost}${portInfo}${cwdInfo}${cmdInfo}${timeoutInfo}`, "info");
		} else {
			// Restore from session, but also check for CLI timeout flag
			state.restoreFromBranch(ctx);

			// Apply CLI timeout even if no CLI host is set
			if (cliTimeout && !isNaN(parseInt(cliTimeout, 10))) {
				state.setTimeout(parseInt(cliTimeout, 10));
				state.persistState();
				state.updateStatus(ctx);
			}
		}
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		state.restoreFromBranch(ctx);
	});

	// Restore state after branching
	pi.on("session_branch", async (_event, ctx) => {
		state.restoreFromBranch(ctx);
	});
}
