/**
 * Jest setup - configures mocks for tests
 */

const mockBashExecute = jest.fn();
const mockCreateBashTool = jest.fn(() => ({ execute: mockBashExecute }));

export { mockBashExecute, mockCreateBashTool };

jest.mock("@mariozechner/pi-coding-agent", () => ({
	DEFAULT_MAX_BYTES: 50000,
	DEFAULT_MAX_LINES: 2000,
	formatSize: (bytes: number) => `${bytes}B`,
	truncateTail: jest.fn((content: string, options?: { maxLines?: number; maxBytes?: number }) => {
		const maxLines = options?.maxLines ?? 2000;
		const lines = content.split("\n");
		const totalLines = lines.length;
		const truncated = totalLines > maxLines;
		const outputLines = truncated ? maxLines : totalLines;
		const outputContent = truncated ? lines.slice(-maxLines).join("\n") : content;
		return {
			content: outputContent,
			truncated,
			outputLines,
			totalLines,
			outputBytes: outputContent.length,
			totalBytes: content.length,
		};
	}),
	createBashTool: mockCreateBashTool,
}));
