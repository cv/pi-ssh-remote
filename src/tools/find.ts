/**
 * SSH-wrapped find tool
 */

import { createFindTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerFindTool(state: SSHState): void {
	state.pi.registerTool({
		name: "find",
		label: "Find (SSH)",
		description: `Search for files by name pattern. When SSH remote is configured, searches on the remote host. Returns matching file paths. Uses fd if available, otherwise find.`,
		parameters: Type.Object({
			pattern: Type.String({ description: "File name pattern (glob-style, e.g. '*.ts', '*.json')" }),
			path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const {
				pattern,
				path: searchPath,
				limit,
			} = params as {
				pattern: string;
				path?: string;
				limit?: number;
			};

			if (!state.getHost()) {
				// Delegate to pi's built-in find tool
				const localFind = createFindTool(ctx.cwd);
				const result = await localFind.execute(_toolCallId, { pattern, path: searchPath, limit }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			const effectiveLimit = limit ?? 1000;
			const searchDir = searchPath || ".";

			// Detect available tools on remote
			const tools = await state.detectRemoteTools(ctx);

			let cmd: string;
			if (tools.hasFd) {
				// Use fd - note: fd uses regex by default, -g for glob patterns
				// fd has --max-results for limiting
				cmd = `fd -g ${state.escapeForShell(pattern)} ${state.escapeForShell(searchDir)} --max-results ${effectiveLimit} 2>/dev/null`;
			} else {
				// Fall back to find
				cmd = `find ${state.escapeForShell(searchDir)} -name ${state.escapeForShell(pattern)} 2>/dev/null | head -n ${effectiveLimit}`;
			}

			const remoteCmd = state.buildRemoteCommand(cmd);

			try {
				const result = await state.sshExec(remoteCmd, { signal, cwd: ctx.cwd });

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "No files found matching pattern" }],
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
			return new Text(prefix + theme.fg("muted", `find ${pattern}`), 0, 0);
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

			// Check for no files found
			if (text === "No files found matching pattern") {
				return new Text(prefix + theme.fg("muted", "No files found"), 0, 0);
			}

			// Count files found
			const files = text.split("\n").filter((line) => line.trim()).length;
			const fileInfo = `${files} file${files === 1 ? "" : "s"} found`;

			// Show first few lines
			const lines = text.split("\n").slice(0, 10);
			let display = lines.join("\n");
			if (text.split("\n").length > 10) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			return new Text(prefix + theme.fg("success", `✓ ${fileInfo}\n`) + display, 0, 0);
		},
	});
}
