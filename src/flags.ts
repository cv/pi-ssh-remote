/**
 * CLI flag registration for pi-ssh-remote extension
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerFlags(pi: ExtensionAPI): void {
	pi.registerFlag("ssh-host", {
		description: "SSH host to connect to (e.g., user@example.com)",
		type: "string",
	});

	pi.registerFlag("ssh-cwd", {
		description: "Remote working directory on the SSH host",
		type: "string",
	});

	pi.registerFlag("ssh-port", {
		description: "SSH port (default: 22)",
		type: "string", // Using string to parse as number later
	});

	pi.registerFlag("ssh-command", {
		description: "Custom SSH command (e.g., 'tsh ssh' for Teleport)",
		type: "string",
	});

	pi.registerFlag("ssh-timeout", {
		description: "Default timeout for SSH operations in seconds (e.g., 60)",
		type: "string",
	});
}
