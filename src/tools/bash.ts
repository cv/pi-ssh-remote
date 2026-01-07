/**
 * SSH-wrapped bash tool
 */

import {
	createBashTool,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { SSHState } from "../types";

export function registerBashTool(state: SSHState): void {
	state.pi.registerTool({
		name: "bash",
		label: "Bash (SSH)",
		description: `Execute a bash command. When SSH remote is configured, executes on the remote host. Returns stdout and stderr. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). Optionally provide a timeout in seconds.`,
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { command, timeout } = params as { command: string; timeout?: number };

			if (!state.getHost()) {
				// Delegate to pi's built-in bash tool
				const localBash = createBashTool(ctx.cwd);
				const result = await localBash.execute(_toolCallId, { command, timeout }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			// Execute remotely via SSH
			const remoteCmd = state.buildRemoteCommand(command);

			try {
				const result = await state.sshExec(remoteCmd, { signal, timeout, cwd: ctx.cwd });

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
						remote: true,
						host: state.getHost(),
						truncation: truncation.truncated ? truncation : undefined,
					},
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
			const cmd = (args as { command?: string }).command || "";
			const host = state.getHost();
			const prefix = host ? theme.fg("accent", `[${host}] `) : "";
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

			const prefix = details?.remote ? theme.fg("accent", "🔌 ") : "";
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
}
