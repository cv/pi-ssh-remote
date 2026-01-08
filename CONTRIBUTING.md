# Contributing to pi-ssh-remote

Thank you for your interest in contributing!

## Project Structure

```
├── index.ts                   # Main entry point (re-exports src/)
├── pi-ssh                     # Wrapper script for seamless usage
├── src/
│   ├── index.ts               # Extension entry, registers flags
│   └── tools/
│       ├── index.ts           # Tool exports
│       └── bash.ts            # SSH-wrapped bash tool
├── tests/
│   ├── setup.ts               # Jest setup and mocks
│   ├── test-utils.ts          # Shared test utilities
│   └── ssh-remote.test.ts     # Unit tests
└── e2e/
    └── sshfs.e2e.test.ts      # End-to-end tests (Docker-based)
```

## Prerequisites

- **Node.js** v18+
- **Docker** (for e2e tests)
- **SSHFS** (for manual testing)

## Getting Started

```bash
git clone https://github.com/cv/pi-ssh-remote.git
cd pi-ssh-remote
npm install
npm test
```

## Running Tests, Linting & Formatting

| Command | Description |
|---------|-------------|
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm test` | Unit tests (fast, no Docker) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run test:e2e` | E2E tests (requires Docker) |
| `npm run test:all` | Both unit and e2e tests |
| `npm run check` | Full check: format + lint + all tests |

## How It Works

The extension is intentionally minimal:

1. **`pi-ssh` wrapper script**: Handles SSHFS mount/unmount and launches pi
2. **Bash tool**: Wraps bash to execute commands remotely via SSH
3. **File tools**: Use pi's built-in tools on the SSHFS mount (no wrapping needed)

## Development Workflow

1. Create a branch for your changes
2. Make changes
3. Add/update tests
4. Run `npm run check`
5. Submit a pull request

## Need Help?

Open an issue on GitHub.
