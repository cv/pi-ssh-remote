/**
 * Shared test utilities for pi-ssh-remote extension tests
 */

// Re-export mocks from setup
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
} from "./setup";

import {
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
} from "./setup";

// Reset all mocks
export function resetAllMocks() {
	mockBashExecute.mockReset();
	mockReadExecute.mockReset();
	mockWriteExecute.mockReset();
	mockEditExecute.mockReset();
	mockGrepExecute.mockReset();
	mockFindExecute.mockReset();
	mockLsExecute.mockReset();
	mockCreateBashTool.mockClear();
	mockCreateReadTool.mockClear();
	mockCreateWriteTool.mockClear();
	mockCreateEditTool.mockClear();
	mockCreateGrepTool.mockClear();
	mockCreateFindTool.mockClear();
	mockCreateLsTool.mockClear();
}

// Mock UI factory
export const createMockUI = () => ({
	notify: jest.fn(),
	setStatus: jest.fn(),
	confirm: jest.fn(),
	select: jest.fn(),
	input: jest.fn(),
	editor: jest.fn(),
	custom: jest.fn(),
	setWidget: jest.fn(),
	setFooter: jest.fn(),
	setHeader: jest.fn(),
	setTitle: jest.fn(),
	setEditorText: jest.fn(),
	getEditorText: jest.fn(),
});

// Mock SessionManager factory
export const createMockSessionManager = () => ({
	getBranch: jest.fn(() => []),
	getEntries: jest.fn(() => []),
	getLeafId: jest.fn(() => "leaf-1"),
	getLeafEntry: jest.fn(() => null),
	getSessionFile: jest.fn(() => null),
});

// Mock Context factory
export const createMockContext = () => ({
	ui: createMockUI(),
	hasUI: true,
	cwd: "/test/cwd",
	sessionManager: createMockSessionManager(),
	modelRegistry: {},
	model: {},
	isIdle: jest.fn(() => true),
	abort: jest.fn(),
	hasPendingMessages: jest.fn(() => false),
});

// Mock ExtensionAPI factory
export const createMockExtensionAPI = () => {
	const registeredTools: Map<string, any> = new Map();
	const registeredCommands: Map<string, any> = new Map();
	const registeredFlags: Map<string, any> = new Map();
	const eventHandlers: Map<string, ((...args: any[]) => any)[]> = new Map();
	const appendedEntries: any[] = [];
	let execMock = jest.fn();

	const api = {
		registerTool: jest.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		registerCommand: jest.fn((name: string, options: any) => {
			registeredCommands.set(name, options);
		}),
		registerFlag: jest.fn((name: string, options: any) => {
			registeredFlags.set(name, { ...options, value: undefined });
		}),
		registerShortcut: jest.fn(),
		registerMessageRenderer: jest.fn(),
		on: jest.fn((event: string, handler: (...args: any[]) => any) => {
			if (!eventHandlers.has(event)) {
				eventHandlers.set(event, []);
			}
			eventHandlers.get(event)!.push(handler);
		}),
		appendEntry: jest.fn((customType: string, data: any) => {
			appendedEntries.push({ customType, data });
		}),
		exec: jest.fn((...args: any[]) => execMock(...args)),
		getFlag: jest.fn((name: string) => registeredFlags.get(name)?.value),
		setActiveTools: jest.fn(),
		getActiveTools: jest.fn(() => ["read", "bash", "edit", "write"]),
		getAllTools: jest.fn(() => ["read", "bash", "edit", "write"]),
		sendMessage: jest.fn(),
		sendUserMessage: jest.fn(),
		events: {
			on: jest.fn(),
			emit: jest.fn(),
			off: jest.fn(),
		},
		_registeredTools: registeredTools,
		_registeredCommands: registeredCommands,
		_registeredFlags: registeredFlags,
		_eventHandlers: eventHandlers,
		_appendedEntries: appendedEntries,
		_setExecMock: (mock: jest.Mock) => {
			execMock = mock;
		},
	};

	return api;
};

// Load extension function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const extensionModule = require("../ssh-remote") as { default: (api: any) => void };
export const extensionFn = extensionModule.default;
