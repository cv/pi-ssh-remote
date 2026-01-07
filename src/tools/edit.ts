/**
 * SSH-wrapped edit tool
 */

import { createEditTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerEditTool(state: SSHState): void {
	state.pi.registerTool({
		name: "edit",
		label: "Edit (SSH)",
		description:
			"Edit a file by replacing exact text. When SSH remote is configured, edits files on the remote host. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
			oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
			newText: Type.String({ description: "New text to replace the old text with" }),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { path, oldText, newText } = params as { path: string; oldText: string; newText: string };

			if (!state.getHost()) {
				// Delegate to pi's built-in edit tool
				const localEdit = createEditTool(ctx.cwd);
				const result = await localEdit.execute(_toolCallId, { path, oldText, newText }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			// For remote edit, we need to:
			// 1. Read the file
			// 2. Check if oldText exists exactly once
			// 3. Replace it with newText
			// 4. Write the file back

			const readRemoteCmd = state.buildRemoteCommand(`cat ${state.escapeForShell(path)}`);

			try {
				// Read current content
				const readResult = await state.sshExec(readRemoteCmd, { signal, cwd: ctx.cwd });

				if (readResult.code !== 0) {
					return {
						content: [{ type: "text", text: `Error reading file: ${readResult.stderr}` }],
						details: { path, remote: true },
						isError: true,
					};
				}

				const currentContent = readResult.stdout;

				// Check how many times oldText appears
				const occurrences = currentContent.split(oldText).length - 1;

				if (occurrences === 0) {
					return {
						content: [
							{
								type: "text",
								text: `Error: oldText not found in file. Make sure it matches exactly (including whitespace).`,
							},
						],
						details: { path, remote: true },
						isError: true,
					};
				}

				if (occurrences > 1) {
					return {
						content: [
							{
								type: "text",
								text: `Error: oldText appears ${occurrences} times in file. It must appear exactly once for safe replacement.`,
							},
						],
						details: { path, occurrences, remote: true },
						isError: true,
					};
				}

				// Perform the replacement
				const newContent = currentContent.replace(oldText, newText);

				// Write back using base64 encoding with chunking (same as write tool)
				const base64Content = Buffer.from(newContent).toString("base64");
				const MAX_CHUNK_SIZE = 65536; // 64KB chunks of base64 data
				const chunks = [];
				for (let i = 0; i < base64Content.length; i += MAX_CHUNK_SIZE) {
					chunks.push(base64Content.slice(i, i + MAX_CHUNK_SIZE));
				}

				// Write chunks
				for (let i = 0; i < chunks.length; i++) {
					const operator = i === 0 ? ">" : ">>";
					const writeCmd = state.buildRemoteCommand(
						`printf '%s' '${chunks[i]}' | base64 -d ${operator} ${state.escapeForShell(path)}`
					);
					const writeResult = await state.sshExec(writeCmd, { signal, cwd: ctx.cwd });

					if (writeResult.code !== 0) {
						return {
							content: [{ type: "text", text: `Error writing file: ${writeResult.stderr}` }],
							details: { path, remote: true },
							isError: true,
						};
					}
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
						remote: true,
						host: state.getHost(),
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
			return new Text(prefix + theme.fg("muted", `edit ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Editing..."), 0, 0);
			}

			const details = result.details as { lineDelta?: number; error?: string; remote?: boolean } | undefined;
			const typedResult = result as ToolResultWithError;

			if (details?.error || typedResult.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "🔌 ") : "";
			const delta = details?.lineDelta || 0;
			const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
			return new Text(prefix + theme.fg("success", `✓ Edited (${deltaStr} lines)`), 0, 0);
		},
	});
}
