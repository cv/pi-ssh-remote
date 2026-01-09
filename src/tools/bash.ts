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
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SSHConfig } from "../index";
import { buildSSHArgs, escapePath } from "../utils/ssh";

export function registerBashTool(pi: ExtensionAPI, getConfig: () => SSHConfig): void {
	pi.registerTool({
		name: "bash",
		label: "Bash (SSH)",
		description: `Execute a bash command. When --ssh-host is configured, executes on the remote host. Returns stdout and stderr. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
		}),

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const { command, timeout } = params as { command: string; timeout?: number };
			const config = getConfig();

			if (!config.host) {
				const localBash = createBashTool(ctx.cwd);
				const result = await localBash.execute(_toolCallId, { command, timeout }, signal, onUpdate);
				return {
					...result,
					details: { ...result.details, remote: false },
				};
			}

			const sshArgs = buildSSHArgs(config);
			const remoteCmd = config.cwd ? `cd '${escapePath(config.cwd)}' && ${command}` : command;

			try {
				const effectiveTimeout = timeout ?? config.timeout;
				const result = await pi.exec(sshArgs[0], [...sshArgs.slice(1), remoteCmd], {
					signal,
					timeout: effectiveTimeout ? effectiveTimeout * 1000 : undefined,
					cwd: ctx.cwd,
				});

				const output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
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
						host: config.host,
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message, remote: true },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const cmd = (args as { command?: string }).command || "";
			const config = getConfig();
			const prefix = config.host ? theme.fg("accent", `[${config.host}] `) : "";
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

			const lines = text.split("\n").slice(0, 10);
			let display = lines.join("\n");
			if (text.split("\n").length > 10) {
				display += `\n${theme.fg("dim", "...")}`;
			}

			return new Text(prefix + display + exitInfo, 0, 0);
		},
	});
}
