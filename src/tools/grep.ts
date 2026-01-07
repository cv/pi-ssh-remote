/**
 * SSH-wrapped grep tool
 */

import { createGrepTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerGrepTool(state: SSHState): void {
	state.pi.registerTool({
		name: "grep",
		label: "Grep (SSH)",
		description: `Search file contents for a pattern. When SSH remote is configured, searches on the remote host. Returns matching lines with file paths and line numbers. Uses rg (ripgrep) if available, otherwise grep.`,
		parameters: Type.Object({
			pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
			path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
			ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
			literal: Type.Optional(
				Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })
			),
			context: Type.Optional(
				Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })
			),
			limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const {
				pattern,
				path: searchPath,
				ignoreCase,
				literal,
				context,
				limit,
			} = params as {
				pattern: string;
				path?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			};

			if (!state.getHost()) {
				// Delegate to pi's built-in grep tool
				const localGrep = createGrepTool(ctx.cwd);
				const result = await localGrep.execute(
					_toolCallId,
					{ pattern, path: searchPath, ignoreCase, literal, context, limit },
					signal,
					onUpdate
				);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			const effectiveLimit = limit ?? 100;
			const searchDir = searchPath || ".";

			// Detect available tools on remote
			const tools = await state.detectRemoteTools(ctx);

			let cmd: string;
			if (tools.hasRg) {
				// Use ripgrep (rg)
				const rgArgs = ["-n", "--color=never"];
				if (ignoreCase) rgArgs.push("-i");
				if (literal) rgArgs.push("-F");
				if (context && context > 0) rgArgs.push(`-C${context}`);
				rgArgs.push("-m", String(effectiveLimit)); // rg has built-in limit

				const escapedPattern = state.escapeForShell(pattern);
				cmd = `rg ${rgArgs.join(" ")} ${escapedPattern} ${state.escapeForShell(searchDir)} 2>/dev/null`;
			} else {
				// Fall back to grep
				const grepArgs = ["-r", "-n", "--color=never"];
				if (ignoreCase) grepArgs.push("-i");
				if (literal) grepArgs.push("-F");
				if (context && context > 0) grepArgs.push(`-C${context}`);

				const escapedPattern = state.escapeForShell(pattern);
				cmd = `grep ${grepArgs.join(" ")} ${escapedPattern} ${state.escapeForShell(searchDir)} 2>/dev/null | head -n ${effectiveLimit}`;
			}

			const remoteCmd = state.buildRemoteCommand(cmd);

			try {
				const result = await state.sshExec(remoteCmd, { signal, cwd: ctx.cwd });

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "No matches found" }],
						details: { remote: true },
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
					details: { remote: true, host: state.getHost() },
				};
			} catch (err: unknown) {
				return {
					content: [{ type: "text", text: `Error: ${state.getErrorMessage(err)}` }],
					details: { error: state.getErrorMessage(err), remote: true },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const pattern = (args as { pattern?: string }).pattern || "";
			const host = state.getHost();
			const prefix = host ? theme.fg("accent", `[${host}] `) : "";
			return new Text(prefix + theme.fg("muted", `grep ${pattern}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching..."), 0, 0);
			}

			const details = result.details as { error?: string; remote?: boolean } | undefined;
			const typedResult = result as ToolResultWithError;

			if (details?.error || typedResult.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "[remote] ") : "";
			const content = result.content[0];
			const text = content?.type === "text" ? content.text : "";

			// Check for no matches
			if (text === "No matches found") {
				return new Text(prefix + theme.fg("muted", "No matches found"), 0, 0);
			}

			// Count matches (lines with file:line: pattern)
			const matches = text.split("\n").filter((line) => line.includes(":")).length;
			const matchInfo = matches > 0 ? `${matches} match${matches === 1 ? "" : "es"}` : "";

			// Show first few lines
			const lines = text.split("\n").slice(0, 10);
			let display = lines.join("\n");
			if (text.split("\n").length > 10) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			return new Text(prefix + theme.fg("success", `✓ ${matchInfo}\n`) + display, 0, 0);
		},
	});
}
