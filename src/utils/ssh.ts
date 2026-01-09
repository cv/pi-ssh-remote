/**
 * Shared SSH utilities
 */

import { parse as parseShellQuote } from "shell-quote";
import type { SSHConfig } from "../index";

/**
 * Build SSH command arguments from config
 */
export function buildSSHArgs(config: SSHConfig): string[] {
	const args: string[] = [];

	if (config.command) {
		const parsed = parseShellQuote(config.command);
		for (const part of parsed) {
			if (typeof part === "string") {
				args.push(part);
			} else {
				throw new Error(
					`Invalid --ssh-command: shell operators (|, >, <, etc.) are not allowed. ` +
						`Use only the SSH command and its flags, e.g., "ssh -i ~/.ssh/mykey" or "ssh -o ProxyJump=bastion". ` +
						`Got: ${JSON.stringify(part)}`
				);
			}
		}
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
 * Extract SSH options from a custom SSH command and convert to SSHFS format.
 */
export function extractSSHOptions(command: string): string[] {
	const opts: string[] = [];
	const parsed = parseShellQuote(command);

	for (let i = 0; i < parsed.length; i++) {
		const part = parsed[i];
		const nextPart = parsed[i + 1];

		if (typeof part !== "string") continue;

		if (part === "-i" && typeof nextPart === "string") {
			opts.push(`IdentityFile=${nextPart}`);
			i++;
		} else if (part === "-o" && typeof nextPart === "string") {
			opts.push(nextPart);
			i++;
		}
	}

	return opts;
}

/**
 * Escape a path for safe use in single-quoted shell strings.
 */
export function escapePath(pathStr: string): string {
	if (pathStr.includes("\0")) {
		throw new Error("Path contains null byte, which is not allowed");
	}

	if (pathStr.includes("\n") || pathStr.includes("\r")) {
		throw new Error("Path contains newline characters, which are not supported");
	}

	return pathStr.replace(/'/g, "'\\''");
}
