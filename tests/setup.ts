/**
 * Jest setup file - configures mocks for all test files
 * This file runs before any tests but after the test framework is initialized
 */

// Define mock functions first, before any imports
const mockBashExecute = jest.fn();
const mockReadExecute = jest.fn();
const mockWriteExecute = jest.fn();
const mockEditExecute = jest.fn();
const mockGrepExecute = jest.fn();
const mockFindExecute = jest.fn();
const mockLsExecute = jest.fn();

const mockCreateBashTool = jest.fn(() => ({ execute: mockBashExecute }));
const mockCreateReadTool = jest.fn(() => ({ execute: mockReadExecute }));
const mockCreateWriteTool = jest.fn(() => ({ execute: mockWriteExecute }));
const mockCreateEditTool = jest.fn(() => ({ execute: mockEditExecute }));
const mockCreateGrepTool = jest.fn(() => ({ execute: mockGrepExecute }));
const mockCreateFindTool = jest.fn(() => ({ execute: mockFindExecute }));
const mockCreateLsTool = jest.fn(() => ({ execute: mockLsExecute }));

// Export mocks for use in tests
export {
	mockBashExecute,
	mockReadExecute,
	mockWriteExecute,
	mockEditExecute,
	mockGrepExecute,
	mockFindExecute,
	mockLsExecute,
	mockCreateBashTool,
	mockCreateReadTool,
	mockCreateWriteTool,
	mockCreateEditTool,
	mockCreateGrepTool,
	mockCreateFindTool,
	mockCreateLsTool,
};

// Mock the @mariozechner/pi-coding-agent module
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
	createReadTool: mockCreateReadTool,
	createWriteTool: mockCreateWriteTool,
	createEditTool: mockCreateEditTool,
	createGrepTool: mockCreateGrepTool,
	createFindTool: mockCreateFindTool,
	createLsTool: mockCreateLsTool,
}));
