/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: {
					module: "commonjs",
					esModuleInterop: true,
				},
			},
		],
	},
	testMatch: ["**/tests/**/*.test.ts", "**/e2e/**/*.test.ts"],
	testPathIgnorePatterns: ["/node_modules/"],
	collectCoverageFrom: ["index.ts", "src/**/*.ts"],
	coverageDirectory: "coverage",
	coverageReporters: ["text", "lcov", "html"],
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};
