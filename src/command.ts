/**
 * SSH command handler for /ssh command
 */

import type { SSHState } from "./types";

export function registerSSHCommand(state: SSHState): void {
	state.pi.registerCommand("ssh", {
		description:
			"Configure SSH remote. Usage: /ssh user@host [cwd] | /ssh port <port> | /ssh command <cmd> | /ssh cwd <path> | /ssh timeout <seconds> | /ssh off",
		handler: async (args, ctx) => {
			const parts = args?.trim().split(/\s+/) || [];

			if (!args?.trim() || parts.length === 0) {
				// Show current config
				const host = state.getHost();
				if (host) {
					const port = state.getPort();
					const cwd = state.getRemoteCwd();
					const command = state.getCommand();
					const timeout = state.getTimeout();
					const portInfo = port ? ` port: ${port}` : "";
					const cwdInfo = cwd ? ` cwd: ${cwd}` : "";
					const cmdInfo = command ? ` command: ${command}` : "";
					const timeoutInfo = timeout ? ` timeout: ${timeout}s` : "";
					ctx.ui.notify(`SSH remote: ${host}${portInfo}${cwdInfo}${cmdInfo}${timeoutInfo}`, "info");
				} else {
					ctx.ui.notify("SSH remote: disabled", "info");
				}
				return;
			}

			if (parts[0] === "off" || parts[0] === "disable") {
				state.setHost(null);
				state.setRemoteCwd(null);
				state.setPort(null);
				state.setCommand(null);
				state.setTimeout(null);
				state.invalidateToolsCache();
				state.persistState();
				state.updateStatus(ctx);
				ctx.ui.notify("SSH remote disabled", "info");
				return;
			}

			// Handle subcommands: /ssh port <port>, /ssh command <cmd>
			if (parts[0] === "port") {
				const port = parseInt(parts[1], 10);
				if (!state.isValidPort(port)) {
					ctx.ui.notify("Invalid port number. Use: /ssh port <1-65535>", "error");
					return;
				}
				state.setPort(port);
				state.persistState();
				state.updateStatus(ctx);
				ctx.ui.notify(`SSH port set to: ${port}`, "info");
				return;
			}

			if (parts[0] === "command" || parts[0] === "cmd") {
				if (parts.length < 2) {
					const command = state.getCommand();
					if (command) {
						ctx.ui.notify(`SSH command: ${command}`, "info");
					} else {
						ctx.ui.notify("SSH command: ssh (default)", "info");
					}
					return;
				}
				const command = parts.slice(1).join(" ");
				state.setCommand(command);
				state.persistState();
				state.updateStatus(ctx);
				ctx.ui.notify(`SSH command set to: ${command}`, "info");
				return;
			}

			if (parts[0] === "timeout") {
				if (parts.length < 2) {
					const timeout = state.getTimeout();
					if (timeout) {
						ctx.ui.notify(`SSH timeout: ${timeout} seconds`, "info");
					} else {
						ctx.ui.notify("SSH timeout: not set (no default timeout)", "info");
					}
					return;
				}
				const timeout = parseInt(parts[1], 10);
				if (isNaN(timeout) || timeout < 1) {
					ctx.ui.notify("Invalid timeout number. Use: /ssh timeout <seconds>", "error");
					return;
				}
				state.setTimeout(timeout);
				state.persistState();
				state.updateStatus(ctx);
				ctx.ui.notify(`SSH timeout set to: ${timeout} seconds`, "info");
				return;
			}

			if (parts[0] === "cwd") {
				if (parts.length < 2) {
					const cwd = state.getRemoteCwd();
					if (cwd) {
						ctx.ui.notify(`SSH working directory: ${cwd}`, "info");
					} else {
						ctx.ui.notify("SSH working directory: not set", "info");
					}
					return;
				}
				const cwd = parts.slice(1).join(" ");
				state.setRemoteCwd(cwd);
				state.persistState();
				state.updateStatus(ctx);
				ctx.ui.notify(`SSH working directory set to: ${cwd}`, "info");
				return;
			}

			// Set new host (and optionally cwd)
			state.setHost(parts[0]);
			state.setRemoteCwd(parts[1] || null);
			state.invalidateToolsCache();
			state.persistState();
			state.updateStatus(ctx);

			const port = state.getPort();
			const cwd = state.getRemoteCwd();
			const command = state.getCommand();
			const portInfo = port ? ` port: ${port}` : "";
			const cwdInfo = cwd ? ` cwd: ${cwd}` : "";
			const cmdInfo = command ? ` via: ${command}` : "";
			ctx.ui.notify(`SSH remote set to: ${parts[0]}${portInfo}${cwdInfo}${cmdInfo}`, "info");
		},
	});
}
