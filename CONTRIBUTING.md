# Contributing to pi-ssh-remote

Thank you for your interest in contributing!

## Project Structure

```
├── ssh-remote.ts           # Main extension (tools + /ssh command)
├── ssh-remote.test.ts      # Unit tests
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

## Running Tests & Linting

| Command | Description |
|---------|-------------|
| `npm run lint` | Run ESLint (strict TypeScript + security rules) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm test` | Unit tests only (fast, no Docker) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run test:e2e` | E2E tests (requires Docker) |
| `npm run test:all` | Both unit and e2e tests |
| `npm run check` | **Full check: lint + all tests** |

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
