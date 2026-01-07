/**
 * Shared types for pi-ssh-remote extension
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// State persisted to session
export interface SSHConfig {
	host: string | null;
	remoteCwd: string | null;
	port: number | null;
	command: string | null;
	timeout: number | null;
}

// Cache for remote tool availability
export interface RemoteToolsCache {
	host: string; // The host this cache is for
	hasRg: boolean;
	hasFd: boolean;
}

// Tool result type with optional isError flag
export interface ToolResultWithError {
	isError?: boolean;
	details?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

// Options for SSH exec helper
export interface SSHExecOptions {
	signal?: AbortSignal;
	timeout?: number; // Tool-level timeout in seconds (overrides default)
	cwd: string;
}

// SSH exec result
export interface SSHExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

// SSH state manager interface - provides access to SSH configuration and helpers
export interface SSHState {
	// Getters
	getHost(): string | null;
	getRemoteCwd(): string | null;
	getPort(): number | null;
	getCommand(): string | null;
	getTimeout(): number | null;

	// Setters
	setHost(host: string | null): void;
	setRemoteCwd(cwd: string | null): void;
	setPort(port: number | null): void;
	setCommand(command: string | null): void;
	setTimeout(timeout: number | null): void;

	// Helpers
	escapeForShell(str: string): string;
	buildRemoteCommand(command: string): string;
	sshPrefix(): string[];
	sshExec(remoteCmd: string, options: SSHExecOptions): Promise<SSHExecResult>;
	getEffectiveTimeout(): number | undefined;
	detectRemoteTools(ctx: ExtensionContext): Promise<RemoteToolsCache>;
	invalidateToolsCache(): void;
	isValidPort(port: number): boolean;
	getErrorMessage(err: unknown): string;

	// State management
	persistState(): void;
	updateStatus(ctx: ExtensionContext): void;
	restoreFromBranch(ctx: ExtensionContext): void;

	// Extension API access
	pi: ExtensionAPI;
}
