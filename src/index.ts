/**
 * pi-ssh-remote - SSH Remote Extension for pi coding agent
 *
 * Redirects all file operations and commands to a remote host via SSH.
 * See README.md for installation and usage instructions.
 *
 * @see https://github.com/cv/pi-ssh-remote
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createSSHState } from "./state";
import { registerFlags } from "./flags";
import { registerSSHCommand } from "./command";
import { registerLifecycleHandlers } from "./lifecycle";
import {
	registerBashTool,
	registerReadTool,
	registerWriteTool,
	registerEditTool,
	registerGrepTool,
	registerFindTool,
	registerLsTool,
} from "./tools/index";

export default function sshRemoteExtension(pi: ExtensionAPI): void {
	// Register CLI flags
	registerFlags(pi);

	// Create shared state manager
	const state = createSSHState(pi);

	// Register /ssh command
	registerSSHCommand(state);

	// Register all SSH-wrapped tools
	registerBashTool(state);
	registerReadTool(state);
	registerWriteTool(state);
	registerEditTool(state);
	registerGrepTool(state);
	registerFindTool(state);
	registerLsTool(state);

	// Register session lifecycle handlers
	registerLifecycleHandlers(state);
}

// Re-export types for consumers
export type { SSHConfig, SSHState, SSHExecOptions, SSHExecResult, RemoteToolsCache } from "./types";
