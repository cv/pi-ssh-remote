# Contributing to pi-ssh-remote

Thank you for your interest in contributing!

## Project Structure

```
├── index.ts                   # Main entry point (re-exports src/)
├── src/
│   ├── index.ts               # Extension entry point
│   ├── types.ts               # TypeScript interfaces
│   ├── state.ts               # SSH state management
│   ├── flags.ts               # CLI flag registration
│   ├── command.ts             # /ssh command handler
│   ├── lifecycle.ts           # Session lifecycle handlers
│   └── tools/
│       ├── index.ts           # Tool exports
│       ├── bash.ts            # Bash tool
│       ├── read.ts            # Read tool
│       ├── write.ts           # Write tool
│       ├── edit.ts            # Edit tool
│       ├── grep.ts            # Grep tool
│       ├── find.ts            # Find tool
│       └── ls.ts              # Ls tool
├── tests/                     # Unit tests
│   ├── setup.ts               # Jest setup and mocks
│   ├── test-utils.ts          # Shared test utilities
│   ├── ssh-remote-core.test.ts
│   ├── ssh-remote-bash.test.ts
│   ├── ssh-remote-read.test.ts
│   ├── ssh-remote-write.test.ts
│   ├── ssh-remote-edit.test.ts
│   ├── ssh-remote-grep.test.ts
│   ├── ssh-remote-find.test.ts
│   ├── ssh-remote-ls.test.ts
│   └── ssh-remote-rendering.test.ts
└── e2e/
    └── ssh-tools.e2e.test.ts  # End-to-end tests (Docker-based)
```

## Prerequisites

- **Node.js** v18+
- **Docker** (for e2e tests)

## Getting Started

```bash
git clone https://github.com/cv/pi-ssh-remote.git
cd pi-ssh-remote
npm install
npm test        # Verify setup with unit tests
```

## Running Tests, Linting & Formatting

| Command | Description |
|---------|-------------|
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without changes |
| `npm run lint` | Run ESLint (strict TypeScript + security rules) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm test` | Unit tests only (fast, no Docker) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run test:e2e` | E2E tests (requires Docker) |
| `npm run test:all` | Both unit and e2e tests |
| `npm run check` | **Full check: format + lint + all tests** |

### Pre-commit Hook

A pre-commit hook automatically runs on every commit:
1. Formats and lints staged `.ts` files
2. Runs unit tests

This ensures code quality before changes are committed.

### About E2E Tests

The e2e tests spin up a Docker container with an SSH server to test real SSH connections:

- First run builds the Docker image (slower)
- Subsequent runs complete in ~13 seconds
- Uses random ports for parallel-safe execution
- Tests all 7 tools with various inputs and error cases
- Automatically cleans up containers and temp files

## Development Workflow

1. Create a branch for your changes
2. Make changes to `ssh-remote.ts`
3. Add/update tests as needed
4. Run `npm run check` to verify (lint + all tests)
5. Submit a pull request

## Need Help?

Open an issue on GitHub if you have questions.
