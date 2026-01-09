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
		// Custom SSH command (e.g., "ssh -i ~/.ssh/mykey" or 'ssh -o "ProxyCommand ssh -W %h:%p bastion"')
		// Use shell-quote for proper parsing of quoted strings
		const parsed = parseShellQuote(config.command);
		for (const part of parsed) {
			if (typeof part === "string") {
				args.push(part);
			} else {
				// shell-quote returns objects for special operators like |, >, etc.
				// These are invalid in SSH commands, so throw an error
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
 * Uses shell-quote for proper parsing of quoted arguments.
 */
export function extractSSHOptions(command: string): string[] {
	const opts: string[] = [];
	const parsed = parseShellQuote(command);

	for (let i = 0; i < parsed.length; i++) {
		const part = parsed[i];
		const nextPart = parsed[i + 1];

		// Skip non-string parts (operators) - these would have been rejected by buildSSHArgs
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
 * Handles edge cases like newlines and other special characters.
 */
export function escapePath(pathStr: string): string {
	// Reject paths with null bytes - these are never valid and could cause issues
	if (pathStr.includes("\0")) {
		throw new Error("Path contains null byte, which is not allowed");
	}

	// Reject paths with newlines - these could break command structure
	if (pathStr.includes("\n") || pathStr.includes("\r")) {
		throw new Error("Path contains newline characters, which are not supported");
	}

	// Escape single quotes for use within single-quoted strings
	// 'path' -> 'path'\''s' (close quote, escaped quote, open quote)
	return pathStr.replace(/'/g, "'\\''");
}
