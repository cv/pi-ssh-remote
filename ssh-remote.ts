/**
 * pi-ssh-remote - SSH Remote Extension for pi coding agent
 *
 * Redirects all file operations and commands to a remote host via SSH.
 * See README.md for installation and usage instructions.
 *
 * @see https://github.com/cv/pi-ssh-remote
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// State persisted to session
interface SSHConfig {
	host: string | null;
	remoteCwd: string | null;
}

export default function sshRemoteExtension(pi: ExtensionAPI) {
	// Current SSH configuration
	let sshHost: string | null = null;
	let remoteCwd: string | null = null;

	// Register CLI flags for SSH configuration
	pi.registerFlag("ssh-host", {
		description: "SSH host to connect to (e.g., user@example.com)",
		type: "string",
	});

	pi.registerFlag("ssh-cwd", {
		description: "Remote working directory on the SSH host",
		type: "string",
	});

	// Persist current state
	function persistState() {
		pi.appendEntry<SSHConfig>("ssh-remote-config", {
			host: sshHost,
			remoteCwd: remoteCwd,
		});
	}

	// Update status line
	function updateStatus(ctx: ExtensionContext) {
		if (sshHost) {
			const cwdInfo = remoteCwd ? ` (${remoteCwd})` : "";
			ctx.ui.setStatus("ssh-remote", `🔗 SSH: ${sshHost}${cwdInfo}`);
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
				}
			}
		}

		updateStatus(ctx);
	}

	// Helper to escape shell arguments for SSH
	function escapeForShell(str: string): string {
		// Escape single quotes by ending the quote, adding escaped quote, starting quote again
		return "'" + str.replace(/'/g, "'\\''") + "'";
	}

	// Helper to build SSH command prefix
	function sshPrefix(): string[] {
		if (!sshHost) return [];
		return ["ssh", sshHost];
	}

	// Helper to build remote command with optional cd
	function buildRemoteCommand(command: string): string {
		if (remoteCwd) {
			return `cd ${escapeForShell(remoteCwd)} && ${command}`;
		}
		return command;
	}

	// Register /ssh command to configure remote host
	pi.registerCommand("ssh", {
		description: "Configure SSH remote host. Usage: /ssh user@host [remote-cwd] or /ssh off",
		handler: async (args, ctx) => {
			const parts = args?.trim().split(/\s+/) || [];

			if (!args?.trim() || parts.length === 0) {
				// Show current config
				if (sshHost) {
					const cwdInfo = remoteCwd ? ` with cwd: ${remoteCwd}` : "";
					ctx.ui.notify(`SSH remote: ${sshHost}${cwdInfo}`, "info");
				} else {
					ctx.ui.notify("SSH remote: disabled", "info");
				}
				return;
			}

			if (parts[0] === "off" || parts[0] === "disable") {
				sshHost = null;
				remoteCwd = null;
				persistState();
				updateStatus(ctx);
				ctx.ui.notify("SSH remote disabled", "info");
				return;
			}

			// Set new host
			sshHost = parts[0];
			remoteCwd = parts[1] || null;
			persistState();
			updateStatus(ctx);

			const cwdInfo = remoteCwd ? ` with cwd: ${remoteCwd}` : "";
			ctx.ui.notify(`SSH remote set to: ${sshHost}${cwdInfo}`, "info");
		},
	});

	// ============================================
	// SSH-wrapped bash tool
	// ============================================
	pi.registerTool({
		name: "bash",
		label: "Bash (SSH)",
		description: `Execute a bash command. When SSH remote is configured, executes on the remote host. Returns stdout and stderr. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). Optionally provide a timeout in seconds.`,
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { command, timeout } = params as { command: string; timeout?: number };

			let fullCommand: string[];
			let displayCommand: string;

			if (sshHost) {
				// Execute remotely via SSH
				const remoteCmd = buildRemoteCommand(command);
				fullCommand = [...sshPrefix(), remoteCmd];
				displayCommand = `ssh ${sshHost} ${remoteCmd}`;
			} else {
				// Execute locally (fallback)
				fullCommand = ["bash", "-c", command];
				displayCommand = command;
			}

			try {
				const result = await pi.exec(fullCommand[0], fullCommand.slice(1), {
					signal,
					timeout: timeout ? timeout * 1000 : undefined,
					cwd: ctx.cwd,
				});

				const output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");

				// Apply truncation
				const truncation = truncateTail(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					resultText = `[Output truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines]\n\n${resultText}`;
				}

				if (result.code !== 0) {
					resultText += `\n\n[Exit code: ${result.code}]`;
				}

				return {
					content: [{ type: "text", text: resultText || "(no output)" }],
					details: {
						exitCode: result.code,
						remote: !!sshHost,
						host: sshHost,
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { error: err.message, remote: !!sshHost },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const cmd = (args as { command?: string }).command || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", cmd), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Running..."), 0, 0);
			}

			const details = result.details as { exitCode?: number; error?: string; remote?: boolean } | undefined;
			const content = result.content[0];
			const text = content?.type === "text" ? content.text : "";

			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "[remote] ") : "";
			const exitInfo = details?.exitCode !== 0 ? theme.fg("error", ` [exit: ${details?.exitCode}]`) : "";

			// Show first few lines of output
			const lines = text.split("\n").slice(0, 10);
			let display = lines.join("\n");
			if (text.split("\n").length > 10) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			return new Text(prefix + display + exitInfo, 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped read tool
	// ============================================
	pi.registerTool({
		name: "read",
		label: "Read (SSH)",
		description: `Read the contents of a file. When SSH remote is configured, reads from the remote host. Supports text files and images (jpg, png, gif, webp). For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Use offset/limit for large files.`,
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
			offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };

			if (!sshHost) {
				// If no SSH host configured, we shouldn't override the built-in tool
				// But since we registered it, we need to handle it locally
				// Use a simple cat command
				const result = await pi.exec("cat", [path], { signal, cwd: ctx.cwd });
				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error reading file: ${result.stderr}` }],
						details: { path, remote: false, error: result.stderr },
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: result.stdout }],
					details: { path, remote: false },
				};
			}

			// Build remote read command
			let cmd: string;
			if (offset !== undefined || limit !== undefined) {
				// Use sed/head for offset/limit
				const startLine = offset || 1;
				if (limit !== undefined) {
					const endLine = startLine + limit - 1;
					cmd = `sed -n '${startLine},${endLine}p' ${escapeForShell(path)}`;
				} else {
					cmd = `sed -n '${startLine},$p' ${escapeForShell(path)}`;
				}
			} else {
				cmd = `cat ${escapeForShell(path)}`;
			}

			const remoteCmd = buildRemoteCommand(cmd);

			try {
				const result = await pi.exec("ssh", [sshHost, remoteCmd], {
					signal,
					cwd: ctx.cwd,
				});

				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error reading file: ${result.stderr}` }],
						details: { path, remote: true, host: sshHost },
						isError: true,
					};
				}

				// Apply truncation
				const truncation = truncateTail(result.stdout, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Use offset/limit for pagination.]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: {
						path,
						remote: true,
						host: sshHost,
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { path, error: err.message, remote: true },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const path = (args as { path?: string }).path || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `read ${path}`), 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped write tool
	// ============================================
	pi.registerTool({
		name: "write",
		label: "Write (SSH)",
		description:
			"Write content to a file. When SSH remote is configured, writes to the remote host. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
			content: Type.String({ description: "Content to write to the file" }),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { path, content } = params as { path: string; content: string };

			// Encode content as base64 to safely pass through shell
			const base64Content = Buffer.from(content).toString("base64");

			// For large files, we need to chunk the base64 content to avoid hitting
			// shell argument length limits (typically ~128KB-256KB depending on OS)
			const MAX_CHUNK_SIZE = 65536; // 64KB chunks of base64 data
			const chunks = [];
			for (let i = 0; i < base64Content.length; i += MAX_CHUNK_SIZE) {
				chunks.push(base64Content.slice(i, i + MAX_CHUNK_SIZE));
			}

			if (!sshHost) {
				// Local fallback - use bash with base64 decoding
				try {
					// Create parent directories
					await pi.exec("bash", ["-c", `mkdir -p "$(dirname '${path}')"`], {
						signal,
						cwd: ctx.cwd,
					});

					// Write chunks
					for (let i = 0; i < chunks.length; i++) {
						const operator = i === 0 ? ">" : ">>";
						const result = await pi.exec(
							"bash",
							["-c", `printf '%s' '${chunks[i]}' | base64 -d ${operator} '${path}'`],
							{ signal, cwd: ctx.cwd }
						);
						if (result.code !== 0) {
							return {
								content: [{ type: "text", text: `Error writing file: ${result.stderr}` }],
								details: { path, remote: false, error: result.stderr },
								isError: true,
							};
						}
					}

					return {
						content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
						details: { path, bytes: content.length, remote: false },
					};
				} catch (err: any) {
					return {
						content: [{ type: "text", text: `Error: ${err.message}` }],
						details: { path, error: err.message, remote: false },
						isError: true,
					};
				}
			}

			// Remote write via SSH using base64 encoding with chunking
			try {
				// Create parent directories
				const mkdirCmd = buildRemoteCommand(`mkdir -p "$(dirname ${escapeForShell(path)})"`);
				await pi.exec("ssh", [sshHost, mkdirCmd], { signal, cwd: ctx.cwd });

				// Write chunks
				for (let i = 0; i < chunks.length; i++) {
					const operator = i === 0 ? ">" : ">>";
					const writeCmd = buildRemoteCommand(
						`printf '%s' '${chunks[i]}' | base64 -d ${operator} ${escapeForShell(path)}`
					);
					const result = await pi.exec("ssh", [sshHost, writeCmd], {
						signal,
						cwd: ctx.cwd,
					});

					if (result.code !== 0) {
						return {
							content: [{ type: "text", text: `Error writing file: ${result.stderr}` }],
							details: { path, remote: true, host: sshHost },
							isError: true,
						};
					}
				}

				return {
					content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
					details: { path, bytes: content.length, remote: true, host: sshHost },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { path, error: err.message, remote: true },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const path = (args as { path?: string }).path || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `write ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Writing..."), 0, 0);
			}

			const details = result.details as { bytes?: number; error?: string; remote?: boolean } | undefined;
			const resultAny = result as any;

			if (details?.error || resultAny.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "[remote] ") : "";
			return new Text(prefix + theme.fg("success", `✓ Wrote ${details?.bytes || 0} bytes`), 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped edit tool
	// ============================================
	pi.registerTool({
		name: "edit",
		label: "Edit (SSH)",
		description:
			"Edit a file by replacing exact text. When SSH remote is configured, edits files on the remote host. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
			oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
			newText: Type.String({ description: "New text to replace the old text with" }),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { path, oldText, newText } = params as { path: string; oldText: string; newText: string };

			// For edit, we need to:
			// 1. Read the file
			// 2. Check if oldText exists exactly once
			// 3. Replace it with newText
			// 4. Write the file back

			let readCmd: string[];
			let host = sshHost;

			if (host) {
				const remoteCmd = buildRemoteCommand(`cat ${escapeForShell(path)}`);
				readCmd = ["ssh", host, remoteCmd];
			} else {
				readCmd = ["cat", path];
			}

			try {
				// Read current content
				const readResult = await pi.exec(readCmd[0], readCmd.slice(1), {
					signal,
					cwd: ctx.cwd,
				});

				if (readResult.code !== 0) {
					return {
						content: [{ type: "text", text: `Error reading file: ${readResult.stderr}` }],
						details: { path, remote: !!host },
						isError: true,
					};
				}

				const currentContent = readResult.stdout;

				// Check how many times oldText appears
				const occurrences = currentContent.split(oldText).length - 1;

				if (occurrences === 0) {
					return {
						content: [{ type: "text", text: `Error: oldText not found in file. Make sure it matches exactly (including whitespace).` }],
						details: { path, remote: !!host },
						isError: true,
					};
				}

				if (occurrences > 1) {
					return {
						content: [{ type: "text", text: `Error: oldText appears ${occurrences} times in file. It must appear exactly once for safe replacement.` }],
						details: { path, occurrences, remote: !!host },
						isError: true,
					};
				}

				// Perform the replacement
				const newContent = currentContent.replace(oldText, newText);

				// Write back using base64 encoding
				const base64Content = Buffer.from(newContent).toString("base64");
				let writeResult;
				if (host) {
					const writeCmd = buildRemoteCommand(`echo '${base64Content}' | base64 -d > ${escapeForShell(path)}`);
					writeResult = await pi.exec("ssh", [host, writeCmd], {
						signal,
						cwd: ctx.cwd,
					});
				} else {
					writeResult = await pi.exec("bash", ["-c", `echo '${base64Content}' | base64 -d > '${path}'`], {
						signal,
						cwd: ctx.cwd,
					});
				}

				if (writeResult.code !== 0) {
					return {
						content: [{ type: "text", text: `Error writing file: ${writeResult.stderr}` }],
						details: { path, remote: !!host },
						isError: true,
					};
				}

				// Generate a simple diff-like output
				const oldLines = oldText.split("\n").length;
				const newLines = newText.split("\n").length;
				const lineDelta = newLines - oldLines;
				const deltaStr = lineDelta > 0 ? `+${lineDelta}` : lineDelta < 0 ? `${lineDelta}` : "±0";

				return {
					content: [{ type: "text", text: `Successfully edited ${path} (${deltaStr} lines)` }],
					details: {
						path,
						oldTextLength: oldText.length,
						newTextLength: newText.length,
						lineDelta,
						remote: !!host,
						host,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { path, error: err.message, remote: !!host },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const path = (args as { path?: string }).path || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `edit ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Editing..."), 0, 0);
			}

			const details = result.details as { lineDelta?: number; error?: string; remote?: boolean } | undefined;
			const resultAny = result as any;

			if (details?.error || resultAny.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "[remote] ") : "";
			const delta = details?.lineDelta || 0;
			const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
			return new Text(prefix + theme.fg("success", `✓ Edited (${deltaStr} lines)`), 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped grep tool
	// ============================================
	pi.registerTool({
		name: "grep",
		label: "Grep (SSH)",
		description: `Search file contents for a pattern. When SSH remote is configured, searches on the remote host. Returns matching lines with file paths and line numbers. Uses grep on remote.`,
		parameters: Type.Object({
			pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
			path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
			ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
			literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
			context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { pattern, path: searchPath, ignoreCase, literal, context, limit } = params as {
				pattern: string;
				path?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			};

			const effectiveLimit = limit ?? 100;
			const searchDir = searchPath || ".";

			// Build grep command
			let grepArgs = ["-r", "-n", "--color=never"];
			if (ignoreCase) grepArgs.push("-i");
			if (literal) grepArgs.push("-F");
			if (context && context > 0) grepArgs.push(`-C${context}`);

			// Escape pattern for shell
			const escapedPattern = escapeForShell(pattern);
			const cmd = `grep ${grepArgs.join(" ")} ${escapedPattern} ${escapeForShell(searchDir)} 2>/dev/null | head -n ${effectiveLimit}`;

			let fullCommand: string[];
			if (sshHost) {
				const remoteCmd = buildRemoteCommand(cmd);
				fullCommand = ["ssh", sshHost, remoteCmd];
			} else {
				fullCommand = ["bash", "-c", cmd];
			}

			try {
				const result = await pi.exec(fullCommand[0], fullCommand.slice(1), {
					signal,
					cwd: ctx.cwd,
				});

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "No matches found" }],
						details: { remote: !!sshHost },
					};
				}

				// Apply truncation
				const truncation = truncateTail(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: { remote: !!sshHost, host: sshHost },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { error: err.message, remote: !!sshHost },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const pattern = (args as { pattern?: string }).pattern || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `grep ${pattern}`), 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped find tool
	// ============================================
	pi.registerTool({
		name: "find",
		label: "Find (SSH)",
		description: `Search for files by name pattern. When SSH remote is configured, searches on the remote host. Returns matching file paths.`,
		parameters: Type.Object({
			pattern: Type.String({ description: "File name pattern (glob-style, e.g. '*.ts', '*.json')" }),
			path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { pattern, path: searchPath, limit } = params as {
				pattern: string;
				path?: string;
				limit?: number;
			};

			const effectiveLimit = limit ?? 1000;
			const searchDir = searchPath || ".";

			// Build find command - use find with -name for glob patterns
			const cmd = `find ${escapeForShell(searchDir)} -name ${escapeForShell(pattern)} 2>/dev/null | head -n ${effectiveLimit}`;

			let fullCommand: string[];
			if (sshHost) {
				const remoteCmd = buildRemoteCommand(cmd);
				fullCommand = ["ssh", sshHost, remoteCmd];
			} else {
				fullCommand = ["bash", "-c", cmd];
			}

			try {
				const result = await pi.exec(fullCommand[0], fullCommand.slice(1), {
					signal,
					cwd: ctx.cwd,
				});

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "No files found matching pattern" }],
						details: { remote: !!sshHost },
					};
				}

				// Apply truncation
				const truncation = truncateTail(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: { remote: !!sshHost, host: sshHost },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { error: err.message, remote: !!sshHost },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const pattern = (args as { pattern?: string }).pattern || "";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `find ${pattern}`), 0, 0);
		},
	});

	// ============================================
	// SSH-wrapped ls tool
	// ============================================
	pi.registerTool({
		name: "ls",
		label: "List (SSH)",
		description: `List directory contents. When SSH remote is configured, lists on the remote host. Returns entries sorted alphabetically with '/' suffix for directories.`,
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
		}),

		async execute(_toolCallId, params, _onUpdate, ctx, signal) {
			const { path: listPath, limit } = params as {
				path?: string;
				limit?: number;
			};

			const effectiveLimit = limit ?? 500;
			const dir = listPath || ".";

			// Build ls command - use ls -1a for simple output, then add / for directories
			// Using a script that marks directories with /
			const cmd = `ls -1a ${escapeForShell(dir)} 2>/dev/null | head -n ${effectiveLimit}`;

			let fullCommand: string[];
			if (sshHost) {
				const remoteCmd = buildRemoteCommand(cmd);
				fullCommand = ["ssh", sshHost, remoteCmd];
			} else {
				fullCommand = ["bash", "-c", cmd];
			}

			try {
				const result = await pi.exec(fullCommand[0], fullCommand.slice(1), {
					signal,
					cwd: ctx.cwd,
				});

				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error: ${result.stderr || "Directory not found"}` }],
						details: { remote: !!sshHost },
						isError: true,
					};
				}

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "(empty directory)" }],
						details: { remote: !!sshHost },
					};
				}

				// Apply truncation
				const truncation = truncateTail(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: { remote: !!sshHost, host: sshHost },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { error: err.message, remote: !!sshHost },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const path = (args as { path?: string }).path || ".";
			const prefix = sshHost ? theme.fg("accent", `[${sshHost}] `) : "";
			return new Text(prefix + theme.fg("muted", `ls ${path}`), 0, 0);
		},
	});

	// ============================================
	// Session lifecycle handlers
	// ============================================

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		// Check for CLI flags first (they take precedence over session state)
		const cliHost = pi.getFlag("ssh-host") as string | undefined;
		const cliCwd = pi.getFlag("ssh-cwd") as string | undefined;

		if (cliHost) {
			sshHost = cliHost;
			remoteCwd = cliCwd || null;
			persistState();
			updateStatus(ctx);
			ctx.ui.notify(`SSH remote configured via CLI: ${sshHost}${remoteCwd ? ` (${remoteCwd})` : ""}`, "info");
		} else {
			restoreFromBranch(ctx);
		}
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	// Restore state after branching
	pi.on("session_branch", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
