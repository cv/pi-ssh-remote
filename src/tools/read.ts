/**
 * SSH-wrapped read tool
 */

import {
	createReadTool,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerReadTool(state: SSHState): void {
	state.pi.registerTool({
		name: "read",
		label: "Read (SSH)",
		description: `Read the contents of a file. When SSH remote is configured, reads from the remote host. Supports text files and images (jpg, png, gif, webp). For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Use offset/limit for large files.`,
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
			offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };

			if (!state.getHost()) {
				// Delegate to pi's built-in read tool
				const localRead = createReadTool(ctx.cwd);
				const result = await localRead.execute(_toolCallId, { path, offset, limit }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			// Build remote read command
			let cmd: string;
			if (offset !== undefined || limit !== undefined) {
				// Use sed/head for offset/limit
				const startLine = offset || 1;
				if (limit !== undefined) {
					const endLine = startLine + limit - 1;
					cmd = `sed -n '${startLine},${endLine}p' ${state.escapeForShell(path)}`;
				} else {
					cmd = `sed -n '${startLine},$p' ${state.escapeForShell(path)}`;
				}
			} else {
				cmd = `cat ${state.escapeForShell(path)}`;
			}

			const remoteCmd = state.buildRemoteCommand(cmd);

			try {
				const result = await state.sshExec(remoteCmd, { signal, cwd: ctx.cwd });

				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error reading file: ${result.stderr}` }],
						details: { path, remote: true, host: state.getHost() },
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
						host: state.getHost(),
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			} catch (err: unknown) {
				return {
					content: [{ type: "text", text: `Error: ${state.getErrorMessage(err)}` }],
					details: { path, error: state.getErrorMessage(err), remote: true },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const path = (args as { path?: string }).path || "";
			const host = state.getHost();
			const prefix = host ? theme.fg("accent", `[${host}] `) : "";
			return new Text(prefix + theme.fg("muted", `read ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Reading..."), 0, 0);
			}

			const details = result.details as
				| { path?: string; error?: string; remote?: boolean; truncation?: object }
				| undefined;
			const typedResult = result as ToolResultWithError;

			if (details?.error || typedResult.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "🔌 ") : "";
			const content = result.content[0];
			const text = content?.type === "text" ? content.text : "";

			// Show first few lines of content
			const lines = text.split("\n").slice(0, 10);
			let display = lines.join("\n");
			if (text.split("\n").length > 10) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			const truncateInfo = details?.truncation ? theme.fg("warning", " [truncated]") : "";
			return new Text(prefix + display + truncateInfo, 0, 0);
		},
	});
}
