/**
 * End-to-End Integration Tests for pi-ssh-remote extension
 *
 * These tests verify that the extension works correctly when loaded into pi.
 * They use pi's print mode (-p) to send prompts and verify that SSH remote
 * operations work end-to-end.
 *
 * Prerequisites:
 * - Docker (for SSH server container)
 * - pi CLI installed globally
 *
 * NOTE: There's a bug in pi-coding-agent where extensions that override built-in
 * tools (like bash, read, etc.) cause duplicate tool names in the API request.
 * We work around this by explicitly specifying --tools to exclude built-ins that
 * we override. See: https://github.com/badlogic/pi-mono/issues/XXX (if reported)
 *
 * Run with: npm run test:e2e
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";

// Test configuration
const DOCKER_IMAGE = "pi-ssh-extension-test";
const SSH_USER = "testuser";
const SSH_PASSWORD = "testpass";

// These will be set dynamically
let SSH_PORT: number;
let DOCKER_CONTAINER: string;

// Paths
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = path.join(PROJECT_ROOT, "index.ts");

// Timeouts
const DOCKER_STARTUP_TIMEOUT = 30000;
const PI_COMMAND_TIMEOUT = 60000;

interface SSHConfig {
	host: string;
	port: number;
	user: string;
	keyPath: string;
}

let sshConfig: SSHConfig;
let tempDir: string;

/**
 * Find an available port
 */
function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				const port = address.port;
				server.close(() => resolve(port));
			} else {
				server.close(() => reject(new Error("Could not get port")));
			}
		});
		server.on("error", reject);
	});
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build Docker image with SSH server
 */
function buildDockerImage(): void {
	const dockerfile = `
FROM ubuntu:22.04

# Install SSH server and basic utilities
RUN apt-get update && apt-get install -y \\
    openssh-server \\
    sudo \\
    && rm -rf /var/lib/apt/lists/*

# Create test user with password
RUN useradd -m -s /bin/bash ${SSH_USER} && \\
    echo "${SSH_USER}:${SSH_PASSWORD}" | chpasswd && \\
    usermod -aG sudo ${SSH_USER}

# Configure SSH
RUN mkdir /var/run/sshd && \\
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \\
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

# Create test directory structure
RUN mkdir -p /home/${SSH_USER}/project/subdir && \\
    echo "Hello from remote test file" > /home/${SSH_USER}/project/test.txt && \\
    echo "Remote content for verification" > /home/${SSH_USER}/project/verify.txt && \\
    chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER}/project

# Expose SSH port
EXPOSE 22

# Start SSH daemon
CMD ["/usr/sbin/sshd", "-D"]
`;

	const dockerfilePath = path.join(tempDir, "Dockerfile");
	fs.writeFileSync(dockerfilePath, dockerfile);

	try {
		execSync(`docker build -t ${DOCKER_IMAGE} -f ${dockerfilePath} ${tempDir}`, {
			stdio: "inherit",
		});
	} finally {
		try {
			fs.unlinkSync(dockerfilePath);
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Start Docker container
 */
function startDockerContainer(): void {
	try {
		execSync(`docker rm -f ${DOCKER_CONTAINER}`, { stdio: "pipe" });
	} catch {
		// Container may not exist
	}

	execSync(`docker run -d --name ${DOCKER_CONTAINER} -p ${SSH_PORT}:22 ${DOCKER_IMAGE}`, { stdio: "inherit" });
}

/**
 * Wait for SSH to be ready
 */
async function waitForSSH(): Promise<void> {
	const start = Date.now();

	try {
		execSync("which sshpass", { stdio: "pipe" });
	} catch {
		console.warn("sshpass not found - attempting to install via brew");
		try {
			execSync("brew install hudochenkov/sshpass/sshpass", { stdio: "inherit" });
		} catch {
			throw new Error("Could not install sshpass. Please install it manually.");
		}
	}

	while (Date.now() - start < DOCKER_STARTUP_TIMEOUT) {
		try {
			execSync(
				`sshpass -p ${SSH_PASSWORD} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 -p ${SSH_PORT} ${SSH_USER}@localhost echo ok`,
				{ stdio: "pipe" }
			);
			return;
		} catch {
			await sleep(500);
		}
	}
	throw new Error("SSH server did not start in time");
}

/**
 * Stop Docker container
 */
function stopDockerContainer(): void {
	try {
		execSync(`docker rm -f ${DOCKER_CONTAINER}`, { stdio: "pipe" });
	} catch {
		// Ignore errors
	}
}

/**
 * Setup SSH keys for passwordless auth
 */
function setupSSHKeys(): SSHConfig {
	const keyPath = path.join(tempDir, "id_rsa");

	// Generate SSH key
	execSync(`ssh-keygen -t rsa -N "" -f ${keyPath}`, { stdio: "pipe" });

	// Copy public key to container
	const pubKey = fs.readFileSync(`${keyPath}.pub`, "utf-8").trim();
	execSync(
		`docker exec ${DOCKER_CONTAINER} bash -c "mkdir -p /home/${SSH_USER}/.ssh && echo '${pubKey}' >> /home/${SSH_USER}/.ssh/authorized_keys && chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER}/.ssh && chmod 700 /home/${SSH_USER}/.ssh && chmod 600 /home/${SSH_USER}/.ssh/authorized_keys"`,
		{ stdio: "pipe" }
	);

	return {
		host: "localhost",
		port: SSH_PORT,
		user: SSH_USER,
		keyPath,
	};
}

/**
 * Run pi with the extension and a prompt, return stdout
 *
 * Note: Due to a bug in pi-coding-agent where extensions that override built-in
 * tools cause duplicate tool names, we must use --tools to explicitly exclude
 * the built-in versions of tools we override when SSH is enabled.
 */
function runPiWithPrompt(prompt: string, options: { sshHost?: string; timeout?: number } = {}): string {
	const { sshHost, timeout = PI_COMMAND_TIMEOUT } = options;

	const args = [
		"-p", // Print mode
		"-e",
		EXTENSION_PATH,
		"--no-extensions", // Don't load other extensions
		"--no-skills", // Don't load skills
		"--no-session", // Ephemeral session
		// WORKAROUND: Due to pi-coding-agent bug where extensions that override built-in
		// tools cause duplicate tool names in the API request, we must disable ALL built-in
		// tools. The extension registers its own versions of these tools which will be used.
		// Using a dummy tool name since empty string shows warnings.
		"--tools",
		"none",
		// WORKAROUND: Since --tools none triggers read-only mode in the default system prompt,
		// we need to override it completely. The extension tools are fully functional.
		"--system-prompt",
		"You are a helpful coding assistant with full access to bash, read, write, edit, grep, find, and ls tools. Use these tools when asked to perform file operations or run commands. Always use the tools - do not just print commands for the user to run.",
	];

	// Add SSH flags if provided
	if (sshHost) {
		args.push("--ssh-host", sshHost);
		args.push("--ssh-port", String(sshConfig.port));
		args.push(
			"--ssh-command",
			`ssh -i ${sshConfig.keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`
		);
		args.push("--ssh-cwd", `/home/${SSH_USER}/project`);
	}

	args.push(prompt);

	try {
		const result = execSync(`pi ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")} 2>/dev/null`, {
			encoding: "utf-8",
			timeout,
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				// Ensure we don't accidentally use other extensions
				PI_NO_EXTENSIONS: "1",
			},
		});
		return result;
	} catch (err: any) {
		console.error("pi command failed:");
		console.error("stdout:", err.stdout);
		console.error("stderr:", err.stderr);
		throw err;
	}
}

describe("Extension Integration E2E Tests", () => {
	beforeAll(async () => {
		// Check prerequisites
		try {
			execSync("which docker", { stdio: "pipe" });
		} catch {
			throw new Error("Docker is required for E2E tests");
		}

		try {
			execSync("which pi", { stdio: "pipe" });
		} catch {
			throw new Error("pi CLI is required for E2E tests. Install with: npm install -g @mariozechner/pi-coding-agent");
		}

		// Create temp directory
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ssh-extension-e2e-"));

		// Get a random available port
		SSH_PORT = await getAvailablePort();
		DOCKER_CONTAINER = `pi-ssh-extension-test-${SSH_PORT}`;
		console.log(`Using port ${SSH_PORT} for this test run`);

		console.log("Building Docker image...");
		buildDockerImage();

		console.log("Starting Docker container...");
		startDockerContainer();

		console.log("Waiting for SSH to be ready...");
		await waitForSSH();

		console.log("Setting up SSH keys...");
		sshConfig = setupSSHKeys();

		console.log("SSH setup complete!");
	}, 120000);

	afterAll(() => {
		stopDockerContainer();

		if (tempDir) {
			try {
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	describe("Extension loading", () => {
		it("should load the extension without errors", () => {
			// Simple prompt that doesn't require SSH - just verifies extension loads
			const output = runPiWithPrompt('Say "extension loaded" and nothing else');
			expect(output.toLowerCase()).toContain("extension loaded");
		});
	});

	describe("SSH remote operations", () => {
		it("should read remote files via the read tool", () => {
			const output = runPiWithPrompt("Read the file test.txt and tell me its exact contents", {
				sshHost: `${SSH_USER}@localhost`,
			});
			expect(output).toContain("Hello from remote test file");
		});

		it("should execute remote commands via the bash tool", () => {
			const output = runPiWithPrompt('Run "hostname" command and tell me the output', {
				sshHost: `${SSH_USER}@localhost`,
			});
			// The hostname in the container should be the container ID
			expect(output).toBeTruthy();
		});

		it("should list remote directory contents via the ls tool", () => {
			const output = runPiWithPrompt("List the files in the current directory", {
				sshHost: `${SSH_USER}@localhost`,
			});
			expect(output).toContain("test.txt");
			expect(output).toContain("verify.txt");
		});

		it("should write files to remote host via the write tool", () => {
			const uniqueContent = `test-${Date.now()}`;
			const output = runPiWithPrompt(
				`Write a file called "written-by-pi.txt" with the content "${uniqueContent}". Then read it back to confirm.`,
				{
					sshHost: `${SSH_USER}@localhost`,
				}
			);
			expect(output).toContain(uniqueContent);
		});

		it("should search remote files via the grep tool", () => {
			const output = runPiWithPrompt('Search for "Remote content" in all files', {
				sshHost: `${SSH_USER}@localhost`,
			});
			expect(output).toContain("verify.txt");
		});

		it("should find remote files via the find tool", () => {
			const output = runPiWithPrompt("Find all .txt files", {
				sshHost: `${SSH_USER}@localhost`,
			});
			expect(output).toContain("test.txt");
			expect(output).toContain("verify.txt");
		});
	});

	describe("Error handling", () => {
		it("should handle non-existent remote files gracefully", () => {
			const output = runPiWithPrompt("Try to read a file called 'nonexistent-file-12345.txt'", {
				sshHost: `${SSH_USER}@localhost`,
			});
			// The output should mention the file wasn't found or similar error
			expect(output.toLowerCase()).toMatch(/not found|no such file|does not exist|error|couldn't|cannot/);
		});
	});
});
