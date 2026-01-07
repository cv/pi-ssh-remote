# Contributing to pi-ssh-remote

Thank you for your interest in contributing to pi-ssh-remote!

## Overview

pi-ssh-remote is an extension for [pi coding agent](https://github.com/badlogic/pi-mono) that redirects file operations and commands to a remote host via SSH. The extension provides SSH-wrapped versions of the standard tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls`.

The codebase consists of:

- `ssh-remote.ts` - Main extension file with tool implementations and SSH command handling
- `ssh-remote.test.ts` - Unit tests for shell escaping and tool logic
- `e2e/ssh-tools.e2e.test.ts` - End-to-end tests against a real SSH server in Docker

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or later)
- **npm** (comes with Node.js)
- **Docker** (for running e2e tests)
- **Git**

## Setting Up

1. **Clone the repository**

   ```bash
   git clone https://github.com/cv/pi-ssh-remote.git
   cd pi-ssh-remote
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Verify the setup**

   ```bash
   npm run test
   ```

   This runs the unit tests to confirm everything is working.

## Running Tests

### Unit Tests

Unit tests are fast and don't require Docker. They test shell escaping, argument handling, and tool logic in isolation.

```bash
# Run unit tests
npm run test

# Run in watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

### End-to-End Tests

E2E tests verify the full SSH tool workflow against a real Docker container running an SSH server. These tests:

- Spin up an Ubuntu container with SSH configured
- Run all 7 tools with various inputs (special characters, large files, error cases)
- Clean up the container after tests complete

```bash
# Run e2e tests (requires Docker)
npm run test:e2e
```

The first run may take longer as it builds the Docker image. Subsequent runs complete in ~13 seconds.

**E2E test features:**
- Uses random ports for parallel-safe execution
- Tests 38 scenarios covering happy paths, edge cases, and error handling
- Automatically cleans up Docker containers and temp files

### All Tests

```bash
# Run both unit and e2e tests
npm run test:all
```

## Development Workflow

1. Create a branch for your changes
2. Make your changes to `ssh-remote.ts`
3. Add/update tests as needed
4. Run `npm run test:all` to verify everything works
5. Submit a pull request

## Code Style

- TypeScript with strict mode
- Use meaningful variable names
- Add comments for complex logic
- Keep functions focused and small

## Need Help?

Open an issue on GitHub if you have questions or run into problems.
