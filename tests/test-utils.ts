/**
 * Shared test utilities
 */

import { mockBashExecute, mockCreateBashTool } from "./setup";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _resetMountState } = require("../src/index");

export { mockBashExecute, mockCreateBashTool };

export function resetAllMocks() {
	mockBashExecute.mockReset();
	mockCreateBashTool.mockClear();
	_resetMountState();
}

export const createMockContext = () => ({
	ui: {
		notify: jest.fn(),
		setStatus: jest.fn(),
	},
	cwd: "/test/cwd",
	sessionManager: { getBranch: jest.fn(() => []) },
});

export const createMockExtensionAPI = () => {
	const registeredTools: Map<string, any> = new Map();
	const registeredFlags: Map<string, any> = new Map();
	const eventHandlers: Map<string, ((...args: any[]) => any)[]> = new Map();
	let execMock = jest.fn();

	return {
		registerTool: jest.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		registerFlag: jest.fn((name: string, options: any) => {
			registeredFlags.set(name, { ...options, value: undefined });
		}),
		on: jest.fn((event: string, handler: (...args: any[]) => any) => {
			if (!eventHandlers.has(event)) {
				eventHandlers.set(event, []);
			}
			eventHandlers.get(event)!.push(handler);
		}),
		getFlag: jest.fn((name: string) => registeredFlags.get(name)?.value),
		exec: jest.fn((...args: any[]) => execMock(...args)),
		_registeredTools: registeredTools,
		_registeredFlags: registeredFlags,
		_eventHandlers: eventHandlers,
		_setExecMock: (mock: jest.Mock) => {
			execMock = mock;
		},
		_setFlag: (name: string, value: string | boolean) => {
			const flag = registeredFlags.get(name);
			if (flag) flag.value = value;
		},
	};
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const extensionFn = require("../index").default;
