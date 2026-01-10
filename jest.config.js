/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: "tsconfig.test.json",
			},
		],
	},
	testMatch: ["**/tests/**/*.test.ts", "**/e2e/**/*.test.ts"],
	testPathIgnorePatterns: ["/node_modules/"],
	collectCoverageFrom: ["index.ts", "src/**/*.ts"],
	coverageDirectory: "coverage",
	coverageReporters: ["text", "lcov", "html"],
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
	moduleNameMapper: {
		"^@mariozechner/pi-coding-agent$": "<rootDir>/__mocks__/@mariozechner/pi-coding-agent.ts",
		"^@mariozechner/pi-tui$": "<rootDir>/__mocks__/@mariozechner/pi-tui.ts",
		"^@sinclair/typebox$": "<rootDir>/__mocks__/@sinclair/typebox.ts",
	},
};
