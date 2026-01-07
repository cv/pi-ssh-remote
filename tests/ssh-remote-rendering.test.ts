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

	// New tests for read, grep, find, ls renderResult functions

	it("should render read result as partial (Reading...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = readTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Reading...");
	});

	it("should render read result with content preview", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "line 1\nline 2\nline 3" }],
			details: { path: "test.txt", remote: true },
		};

		const rendered = readTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[remote]");
		expect(rendered.text).toContain("line 1");
	});

	it("should render read result with truncation indicator", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "content" }],
			details: { path: "test.txt", remote: true, truncation: { truncated: true } },
		};

		const rendered = readTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[truncated]");
	});

	it("should render read error result", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "File not found" }],
			details: { error: "File not found" },
			isError: true,
		};

		const rendered = readTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("File not found");
		expect(rendered.text).toContain("[error]");
	});

	it("should render grep result as partial (Searching...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = grepTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Searching...");
	});

	it("should render grep result with match count", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "file.txt:1:match1\nfile.txt:5:match2\nother.txt:3:match3" }],
			details: { remote: true },
		};

		const rendered = grepTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[remote]");
		expect(rendered.text).toContain("3 matches");
	});

	it("should render grep result with no matches", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "No matches found" }],
			details: { remote: true },
		};

		const rendered = grepTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("No matches found");
	});

	it("should render grep error result", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const grepTool = api._registeredTools.get("grep");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "Search failed" }],
			details: { error: "Search failed" },
			isError: true,
		};

		const rendered = grepTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Search failed");
		expect(rendered.text).toContain("[error]");
	});

	it("should render find result as partial (Searching...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = findTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Searching...");
	});

	it("should render find result with file count", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: "./src/file1.ts\n./src/file2.ts\n./lib/file3.ts" }],
			details: { remote: true },
		};

		const rendered = findTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[remote]");
		expect(rendered.text).toContain("3 files found");
	});

	it("should render find result with no files found", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "No files found matching pattern" }],
			details: { remote: true },
		};

		const rendered = findTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("No files found");
	});

	it("should render find error result", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const findTool = api._registeredTools.get("find");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "Search failed" }],
			details: { error: "Search failed" },
			isError: true,
		};

		const rendered = findTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Search failed");
		expect(rendered.text).toContain("[error]");
	});

	it("should render ls result as partial (Listing...)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const lsTool = api._registeredTools.get("ls");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "" }],
			details: {},
		};

		const rendered = lsTool.renderResult(result, { isPartial: true, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Listing...");
	});

	it("should render ls result with entry count", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const lsTool = api._registeredTools.get("ls");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		const result = {
			content: [{ type: "text", text: ".\n..\nfile1.txt\nfile2.txt\nsubdir" }],
			details: { remote: true },
		};

		const rendered = lsTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[remote]");
		expect(rendered.text).toContain("3 entries"); // excludes . and ..
	});

	it("should render ls result for empty directory", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const lsTool = api._registeredTools.get("ls");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "(empty directory)" }],
			details: { remote: true },
		};

		const rendered = lsTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("(empty directory)");
	});

	it("should render ls error result", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const lsTool = api._registeredTools.get("ls");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
		};

		const result = {
			content: [{ type: "text", text: "Directory not found" }],
			details: { error: "Directory not found" },
			isError: true,
		};

		const rendered = lsTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("Directory not found");
		expect(rendered.text).toContain("[error]");
	});

	it("should render read result with many lines (truncated display)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const readTool = api._registeredTools.get("read");
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
			details: { path: "test.txt", remote: false },
		};

		const rendered = readTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[dim]...[/dim]");
	});

	it("should render ls result with many entries (truncated display)", async () => {
		const api = createMockExtensionAPI();
		extensionFn(api);

		const lsTool = api._registeredTools.get("ls");
		const mockTheme = {
			fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			dim: (text: string) => `~${text}~`,
		};

		// Generate more than 15 entries
		const manyEntries = Array(20)
			.fill(0)
			.map((_, i) => `file${i}.txt`)
			.join("\n");
		const result = {
			content: [{ type: "text", text: manyEntries }],
			details: { remote: true },
		};

		const rendered = lsTool.renderResult(result, { isPartial: false, expanded: false }, mockTheme);
		expect(rendered.text).toContain("[dim]...[/dim]");
	});
});
