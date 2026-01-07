/**
 * SSH-wrapped ls tool
 */

import { createLsTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerLsTool(state: SSHState): void {
	state.pi.registerTool({
		name: "ls",
		label: "List (SSH)",
		description: `List directory contents. When SSH remote is configured, lists on the remote host. Returns entries sorted alphabetically with '/' suffix for directories.`,
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { path: listPath, limit } = params as {
				path?: string;
				limit?: number;
			};

			if (!state.getHost()) {
				// Delegate to pi's built-in ls tool
				const localLs = createLsTool(ctx.cwd);
				const result = await localLs.execute(_toolCallId, { path: listPath, limit }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			const effectiveLimit = limit ?? 500;
			const dir = listPath || ".";

			// Build ls command - use ls -1a for simple output
			const cmd = `ls -1a ${state.escapeForShell(dir)} 2>/dev/null | head -n ${effectiveLimit}`;

			const remoteCmd = state.buildRemoteCommand(cmd);

			try {
				const result = await state.sshExec(remoteCmd, { signal, cwd: ctx.cwd });

				if (result.code !== 0) {
					return {
						content: [{ type: "text", text: `Error: ${result.stderr || "Directory not found"}` }],
						details: { remote: true },
						isError: true,
					};
				}

				const output = result.stdout.trim();

				if (!output) {
					return {
						content: [{ type: "text", text: "(empty directory)" }],
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
			const path = (args as { path?: string }).path || ".";
			const host = state.getHost();
			const prefix = host ? theme.fg("accent", `[${host}] `) : "";
			return new Text(prefix + theme.fg("muted", `ls ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Listing..."), 0, 0);
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

			// Check for empty directory
			if (text === "(empty directory)") {
				return new Text(prefix + theme.fg("muted", "(empty directory)"), 0, 0);
			}

			// Count entries (excluding . and ..)
			const entries = text.split("\n").filter((line) => line.trim() && line !== "." && line !== "..").length;
			const entryInfo = `${entries} entr${entries === 1 ? "y" : "ies"}`;

			// Show first few lines
			const lines = text.split("\n").slice(0, 15);
			let display = lines.join("\n");
			if (text.split("\n").length > 15) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			return new Text(prefix + theme.fg("success", `✓ ${entryInfo}\n`) + display, 0, 0);
		},
	});
}
