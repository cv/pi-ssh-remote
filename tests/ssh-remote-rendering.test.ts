/**
 * Rendering tests for pi-ssh-remote extension
 * Tests render functions for tool calls and results
 */

import { createMockExtensionAPI, createMockContext, extensionFn, resetAllMocks } from "./test-utils";

describe("ssh-remote extension - render functions", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it("should render bash call with SSH prefix when configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const ctx = createMockContext();
		const sshCommand = api._registeredCommands.get("ssh");
		await sshCommand.handler("user@server.com", ctx);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			bold: (text: string) => `**${text}**`,
		};

		const rendered = bashTool.renderCall({ command: "ls -la" }, mockTheme);
		expect(rendered.text).toContain("user@server.com");
		expect(rendered.text).toContain("ls -la");
	});

	it("should render bash result with remote prefix", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			bold: (text: string) => `**${text}**`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "output line 1\noutput line 2" }],
			details: { exitCode: 0, remote: true },
		};

		const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[remote]");
		expect(rendered.text).toContain("output line 1");
	});

	it("should render partial bash result as 'Running...'", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = bashTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Running...");
	});

	it("should render write result with byte count", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const writeTool = api._registeredTools.get("write");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			bold: (text: string) => `**${text}**`,
		};

		const result = {
			content: [{ type: "text", text: "Success" }],
			details: { bytes: 1024, remote: true },
		};

		const rendered = writeTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("1024");
		expect(rendered.text).toContain("[remote]");
	});

	it("should render edit result with line delta", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const editTool = api._registeredTools.get("edit");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			bold: (text: string) => `**${text}**`,
		};

		const result = {
			content: [{ type: "text", text: "Success" }],
			details: { lineDelta: 5, remote: true },
		};

		const rendered = editTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("+5");
		expect(rendered.text).toContain("[remote]");
	});

	it("should render error results correctly", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const writeTool = api._registeredTools.get("write");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "Permission denied" }],
			details: { error: "Permission denied" },
			isError: true,
		};

		const rendered = writeTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Permission denied");
		expect(rendered.text).toContain("[error]");
	});

	it("should render bash result with non-zero exit code", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "error output" }],
			details: { exitCode: 1, remote: false },
		};

		const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[exit: 1]");
		expect(rendered.text).toContain("[error]");
	});

	it("should render bash result with error in details", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: { error: "Connection timeout" },
		};

		const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Connection timeout");
	});

	it("should render bash result with many lines (truncated display)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const bashTool = api._registeredTools.get("bash");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		// Generate more than 10 lines
		const manyLines = Array(15)
			.fill(0)
			.map((_, i) => `line ${i}`)
			.join("\n");
		const result = {
			content: [{ type: "text", text: manyLines }],
			details: { exitCode: 0, remote: false },
		};

		const rendered = bashTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[dim]...[/dim]"); // Should show truncation indicator
	});

	it("should render read call without SSH prefix when not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = readTool.renderCall({ path: "test.txt" }, mockTheme);
		// When not configured, there's no [accent] prefix for the host
		expect(rendered.text).not.toContain("[accent]");
		expect(rendered.text).toContain("read test.txt");
	});

	it("should render write call without SSH prefix when not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const writeTool = api._registeredTools.get("write");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = writeTool.renderCall({ path: "test.txt" }, mockTheme);
		expect(rendered.text).toContain("write test.txt");
	});

	it("should render edit call without SSH prefix when not configured", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const editTool = api._registeredTools.get("edit");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const rendered = editTool.renderCall({ path: "test.txt" }, mockTheme);
		expect(rendered.text).toContain("edit test.txt");
	});

	it("should render edit result as partial (Editing...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const editTool = api._registeredTools.get("edit");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = editTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Editing...");
	});

	it("should render write result as partial (Writing...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const writeTool = api._registeredTools.get("write");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = writeTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Writing...");
	});

	it("should render edit error result", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const editTool = api._registeredTools.get("edit");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "oldText not found" }],
			details: { error: "not found" },
			isError: true,
		};

		const rendered = editTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("oldText not found");
		expect(rendered.text).toContain("[error]");
	});
});
