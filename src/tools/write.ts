/**
 * SSH-wrapped write tool
 */

import { createWriteTool } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState, ToolResultWithError } from "../types";

export function registerWriteTool(state: SSHState): void {
	state.pi.registerTool({
		name: "write",
		label: "Write (SSH)",
		description:
			"Write content to a file. When SSH remote is configured, writes to the remote host. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
			content: Type.String({ description: "Content to write to the file" }),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { path, content } = params as { path: string; content: string };

			if (!state.getHost()) {
				// Delegate to pi's built-in write tool
				const localWrite = createWriteTool(ctx.cwd);
				const result = await localWrite.execute(_toolCallId, { path, content }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			// Encode content as base64 to safely pass through shell
			const base64Content = Buffer.from(content).toString("base64");

			// For large files, we need to chunk the base64 content to avoid hitting
			// shell argument length limits (typically ~128KB-256KB depending on OS)
			const MAX_CHUNK_SIZE = 65536; // 64KB chunks of base64 data
			const chunks = [];
			for (let i = 0; i < base64Content.length; i += MAX_CHUNK_SIZE) {
				chunks.push(base64Content.slice(i, i + MAX_CHUNK_SIZE));
			}

			// Remote write via SSH using base64 encoding with chunking
			try {
				// Create parent directories
				const mkdirCmd = state.buildRemoteCommand(`mkdir -p "$(dirname ${state.escapeForShell(path)})"`);
				await state.sshExec(mkdirCmd, { signal, cwd: ctx.cwd });

				// Write chunks
				for (let i = 0; i < chunks.length; i++) {
					const operator = i === 0 ? ">" : ">>";
					const writeCmd = state.buildRemoteCommand(
						`printf '%s' '${chunks[i]}' | base64 -d ${operator} ${state.escapeForShell(path)}`
					);
					const result = await state.sshExec(writeCmd, { signal, cwd: ctx.cwd });

					if (result.code !== 0) {
						return {
							content: [{ type: "text", text: `Error writing file: ${result.stderr}` }],
							details: { path, remote: true, host: state.getHost() },
							isError: true,
						};
					}
				}

				return {
					content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
					details: { path, bytes: content.length, remote: true, host: state.getHost() },
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
			return new Text(prefix + theme.fg("muted", `write ${path}`), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Writing..."), 0, 0);
			}

			const details = result.details as { bytes?: number; error?: string; remote?: boolean } | undefined;
			const typedResult = result as ToolResultWithError;

			if (details?.error || typedResult.isError) {
				const content = result.content[0];
				const text = content?.type === "text" ? content.text : "Error";
				return new Text(theme.fg("error", text), 0, 0);
			}

			const prefix = details?.remote ? theme.fg("accent", "🔌 ") : "";
			return new Text(prefix + theme.fg("success", `✓ Wrote ${details?.bytes || 0} bytes`), 0, 0);
		},
	});
}
