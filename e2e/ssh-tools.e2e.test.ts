/**
 * End-to-End Tests for pi-ssh-remote extension tools
 *
 * These tests verify that SSH tool operations work correctly against a real
 * Docker container with SSH access. They test the tool implementations directly
 * without LLM involvement.
 *
 * Prerequisites:
 * - Docker (for SSH server container)
 *
 * Run with: npm run test:e2e
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";

// Test configuration
const DOCKER_IMAGE = "pi-ssh-tools-test";
const SSH_USER = "testuser";
const SSH_PASSWORD = "testpass";

// These will be set dynamically
let SSH_PORT: number;
let DOCKER_CONTAINER: string;

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

// Timeouts
const DOCKER_STARTUP_TIMEOUT = 30000;
const SSH_COMMAND_TIMEOUT = 10000;

// Paths
const TEST_DIR = path.resolve(__dirname);

interface SSHConfig {
	host: string;
	port: number;
	user: string;
	keyPath: string;
}

let sshConfig: SSHConfig;
let tempDir: string;

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute SSH command and return result
 */
function sshExec(command: string, config: SSHConfig = sshConfig): { stdout: string; stderr: string; code: number } {
	try {
		const sshArgs = [
			"-o",
			"StrictHostKeyChecking=no",
			"-o",
			"UserKnownHostsFile=/dev/null",
			"-o",
			"BatchMode=yes",
			"-i",
			config.keyPath,
			"-p",
			String(config.port),
			`${config.user}@${config.host}`,
			command,
		];
		const stdout = execSync(`ssh ${sshArgs.map((a) => `"${a}"`).join(" ")}`, {
			encoding: "utf-8",
			timeout: SSH_COMMAND_TIMEOUT,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { stdout, stderr: "", code: 0 };
	} catch (err: any) {
		return {
			stdout: err.stdout?.toString() || "",
			stderr: err.stderr?.toString() || "",
			code: err.status || 1,
		};
	}
}

/**
 * Escape for shell (matching extension's escapeForShell)
 */
function escapeForShell(str: string): string {
	return "'" + str.replace(/'/g, "'\\''") + "'";
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
    echo "Hello from test file" > /home/${SSH_USER}/project/test.txt && \\
    printf "line1\\nline2\\nline3\\nline4\\nline5\\nline6\\nline7\\nline8\\nline9\\nline10\\n" > /home/${SSH_USER}/project/multiline.txt && \\
    echo '{"name": "test", "version": "1.0.0"}' > /home/${SSH_USER}/project/package.json && \\
    echo "console.log('hello');" > /home/${SSH_USER}/project/index.js && \\
    echo "nested content" > /home/${SSH_USER}/project/subdir/nested.txt && \\
    chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER}/project

# Expose SSH port
EXPOSE 22

# Start SSH daemon
CMD ["/usr/sbin/sshd", "-D"]
`;

	// Write Dockerfile
	const dockerfilePath = path.join(TEST_DIR, "Dockerfile.ssh-tools");
	fs.writeFileSync(dockerfilePath, dockerfile);

	try {
		execSync(`docker build -t ${DOCKER_IMAGE} -f ${dockerfilePath} ${TEST_DIR}`, {
			stdio: "inherit",
		});
	} finally {
		// Clean up Dockerfile
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
	// Stop any existing container
	try {
		execSync(`docker rm -f ${DOCKER_CONTAINER}`, { stdio: "pipe" });
	} catch {
		// Container may not exist
	}

	// Start new container
	execSync(`docker run -d --name ${DOCKER_CONTAINER} -p ${SSH_PORT}:22 ${DOCKER_IMAGE}`, { stdio: "inherit" });
}

/**
 * Wait for SSH to be ready
 */
async function waitForSSH(): Promise<void> {
	const start = Date.now();

	// First, check if sshpass is available
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
	// Create a temporary directory for SSH keys
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ssh-tools-test-"));
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

describe("SSH Tools E2E Tests", () => {
	beforeAll(async () => {
		// Check prerequisites
		try {
			execSync("which docker", { stdio: "pipe" });
		} catch {
			throw new Error("Docker is required for E2E tests");
		}

		// Get a random available port for this test run
		SSH_PORT = await getAvailablePort();
		DOCKER_CONTAINER = `pi-ssh-tools-test-${SSH_PORT}`;
		console.log(`Using port ${SSH_PORT} for this test run`);

		console.log("Building Docker image...");
		buildDockerImage();

		console.log("Starting Docker container...");
		startDockerContainer();

		console.log("Waiting for SSH to be ready...");
		await waitForSSH();

		console.log("Setting up SSH keys...");
		sshConfig = setupSSHKeys();

		// Verify SSH connection works
		const result = sshExec("echo 'SSH connection test'");
		if (result.code !== 0) {
			throw new Error(`SSH connection failed: ${result.stderr}`);
		}
		console.log("SSH connection verified!");
	}, 120000);

	afterAll(() => {
		stopDockerContainer();

		// Clean up temp directory
		if (tempDir) {
			try {
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	describe("bash-equivalent: remote command execution", () => {
		it("should execute simple commands", () => {
			const result = sshExec("echo 'hello world'");
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("hello world");
		});

		it("should execute commands in specified directory", () => {
			const result = sshExec(`cd /home/${SSH_USER}/project && pwd`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(`/home/${SSH_USER}/project`);
		});

		it("should capture exit codes", () => {
			const result = sshExec("exit 42");
			expect(result.code).toBe(42);
		});

		it("should handle commands with stderr output", () => {
			// Test that we can execute commands that produce stderr
			// Note: With BatchMode=yes and key-based auth, SSH may handle stderr differently
			// The important thing is the command executes and we can detect failure
			const result = sshExec("ls /nonexistent_directory_xyz 2>&1");
			expect(result.code).not.toBe(0);
			// Output should mention the missing directory
			expect(result.stdout + result.stderr).toMatch(/no such file|not found|cannot access/i);
		});

		it("should handle pipes and redirections", () => {
			const result = sshExec("echo 'test' | cat | tr 't' 'T'");
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("TesT");
		});
	});

	describe("read-equivalent: remote file reading", () => {
		it("should read file contents", () => {
			const result = sshExec(`cat /home/${SSH_USER}/project/test.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("Hello from test file");
		});

		it("should read with offset and limit (sed)", () => {
			// Read lines 3-5 (offset=3, limit=3)
			const result = sshExec(`sed -n '3,5p' /home/${SSH_USER}/project/multiline.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("line3\nline4\nline5");
		});

		it("should read from offset to end (sed)", () => {
			// Create a known file for this test
			sshExec(`printf 'line1\\nline2\\nline3\\nline4\\nline5\\n' > /home/${SSH_USER}/project/offset_test.txt`);

			// Read from line 3 to end
			const result = sshExec(`sed -n '3,\\$p' /home/${SSH_USER}/project/offset_test.txt`);
			expect(result.code).toBe(0);
			// Should have lines 3, 4, 5
			const lines = result.stdout.trim().split("\n");
			expect(lines.length).toBe(3);
			expect(lines[0]).toBe("line3");
		});

		it("should handle file not found", () => {
			const result = sshExec(`cat /home/${SSH_USER}/project/nonexistent.txt`);
			expect(result.code).not.toBe(0);
			expect(result.stderr).toMatch(/no such file|not found/i);
		});

		it("should handle special characters in path", () => {
			// Create file with special name
			sshExec(`echo "special" > /home/${SSH_USER}/project/'file with spaces.txt'`);
			const result = sshExec(`cat /home/${SSH_USER}/project/'file with spaces.txt'`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("special");
		});
	});

	describe("write-equivalent: remote file writing", () => {
		it("should write content via base64", () => {
			const content = "Hello, written via base64!";
			const base64 = Buffer.from(content).toString("base64");
			const result = sshExec(
				`echo '${base64}' | base64 -d > /home/${SSH_USER}/project/written.txt && cat /home/${SSH_USER}/project/written.txt`
			);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});

		it("should create parent directories", () => {
			const content = "nested write test";
			const base64 = Buffer.from(content).toString("base64");
			const result = sshExec(
				`mkdir -p /home/${SSH_USER}/project/new/nested/dir && echo '${base64}' | base64 -d > /home/${SSH_USER}/project/new/nested/dir/file.txt && cat /home/${SSH_USER}/project/new/nested/dir/file.txt`
			);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});

		it("should handle special characters in content", () => {
			const content = "Special chars: $HOME `whoami` && || ; 'quotes' \"double\"";
			const base64 = Buffer.from(content).toString("base64");
			const result = sshExec(
				`printf '%s' '${base64}' | base64 -d > /home/${SSH_USER}/project/special.txt && cat /home/${SSH_USER}/project/special.txt`
			);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});

		it("should handle binary-like content", () => {
			// Content with null bytes and control characters
			const content = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]).toString("base64");
			const result = sshExec(
				`printf '%s' '${content}' | base64 -d > /home/${SSH_USER}/project/binary.bin && base64 /home/${SSH_USER}/project/binary.bin`
			);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});

		it("should handle large content with chunking", () => {
			// Generate content larger than typical shell limits
			const largeContent = "x".repeat(100000);
			const base64 = Buffer.from(largeContent).toString("base64");

			// Split into chunks (like the extension does)
			const chunkSize = 65536;
			const chunks: string[] = [];
			for (let i = 0; i < base64.length; i += chunkSize) {
				chunks.push(base64.slice(i, i + chunkSize));
			}

			// Write first chunk
			let result = sshExec(`printf '%s' '${chunks[0]}' | base64 -d > /home/${SSH_USER}/project/large.txt`);
			expect(result.code).toBe(0);

			// Append remaining chunks
			for (let i = 1; i < chunks.length; i++) {
				result = sshExec(`printf '%s' '${chunks[i]}' | base64 -d >> /home/${SSH_USER}/project/large.txt`);
				expect(result.code).toBe(0);
			}

			// Verify size
			result = sshExec(`wc -c < /home/${SSH_USER}/project/large.txt`);
			expect(result.code).toBe(0);
			expect(parseInt(result.stdout.trim())).toBe(largeContent.length);
		});
	});

	describe("edit-equivalent: remote file editing", () => {
		beforeEach(() => {
			// Reset editable file before each test
			sshExec(`echo "hello world original" > /home/${SSH_USER}/project/editable.txt`);
		});

		it("should replace exact text", () => {
			// Read, replace, write pattern
			const readResult = sshExec(`cat /home/${SSH_USER}/project/editable.txt`);
			const content = readResult.stdout;

			// Check oldText exists exactly once
			const oldText = "original";
			const newText = "modified";
			const occurrences = content.split(oldText).length - 1;
			expect(occurrences).toBe(1);

			// Perform replacement
			const newContent = content.replace(oldText, newText);
			const base64 = Buffer.from(newContent).toString("base64");

			const writeResult = sshExec(`echo '${base64}' | base64 -d > /home/${SSH_USER}/project/editable.txt`);
			expect(writeResult.code).toBe(0);

			// Verify
			const verifyResult = sshExec(`cat /home/${SSH_USER}/project/editable.txt`);
			expect(verifyResult.stdout).toContain("modified");
			expect(verifyResult.stdout).not.toContain("original");
		});

		it("should fail when oldText not found", () => {
			const readResult = sshExec(`cat /home/${SSH_USER}/project/editable.txt`);
			const content = readResult.stdout;

			const oldText = "nonexistent";
			const occurrences = content.split(oldText).length - 1;
			expect(occurrences).toBe(0); // Simulating the check that would fail
		});

		it("should fail when oldText appears multiple times", () => {
			// Create file with duplicate text
			sshExec(`echo "hello hello hello" > /home/${SSH_USER}/project/editable.txt`);

			const readResult = sshExec(`cat /home/${SSH_USER}/project/editable.txt`);
			const content = readResult.stdout;

			const oldText = "hello";
			const occurrences = content.split(oldText).length - 1;
			expect(occurrences).toBe(3); // Simulating the check that would fail
		});
	});

	describe("grep-equivalent: remote content search", () => {
		it("should find matching lines", () => {
			const result = sshExec(`grep -r -n 'Hello' /home/${SSH_USER}/project/ 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("test.txt");
			expect(result.stdout).toContain("Hello");
		});

		it("should support case-insensitive search", () => {
			const result = sshExec(`grep -r -n -i 'HELLO' /home/${SSH_USER}/project/ 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("Hello");
		});

		it("should support literal pattern search", () => {
			// Create file with regex-like content
			sshExec(`echo "test [pattern] here" > /home/${SSH_USER}/project/regex.txt`);
			const result = sshExec(`grep -r -n -F '[pattern]' /home/${SSH_USER}/project/ 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("[pattern]");
		});

		it("should support context lines", () => {
			const result = sshExec(`grep -r -n -C2 'line5' /home/${SSH_USER}/project/multiline.txt 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("line3");
			expect(result.stdout).toContain("line4");
			expect(result.stdout).toContain("line5");
			expect(result.stdout).toContain("line6");
			expect(result.stdout).toContain("line7");
		});

		it("should return no matches gracefully", () => {
			const result = sshExec(`grep -r 'xyznonexistent123' /home/${SSH_USER}/project/ 2>/dev/null`);
			expect(result.code).toBe(1); // grep returns 1 for no matches
			expect(result.stdout.trim()).toBe("");
		});
	});

	describe("find-equivalent: remote file search", () => {
		it("should find files by pattern", () => {
			const result = sshExec(`find /home/${SSH_USER}/project -name '*.txt' 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("test.txt");
			expect(result.stdout).toContain("multiline.txt");
		});

		it("should find files by extension", () => {
			const result = sshExec(`find /home/${SSH_USER}/project -name '*.json' 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("package.json");
		});

		it("should find files in subdirectories", () => {
			const result = sshExec(`find /home/${SSH_USER}/project -name 'nested.txt' 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("subdir/nested.txt");
		});

		it("should respect result limit", () => {
			const result = sshExec(`find /home/${SSH_USER}/project -name '*.txt' 2>/dev/null | head -n 2`);
			expect(result.code).toBe(0);
			const lines = result.stdout.trim().split("\n").filter(Boolean);
			expect(lines.length).toBeLessThanOrEqual(2);
		});

		it("should handle no matches", () => {
			const result = sshExec(`find /home/${SSH_USER}/project -name '*.nonexistent' 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("");
		});
	});

	describe("ls-equivalent: remote directory listing", () => {
		it("should list directory contents", () => {
			const result = sshExec(`ls -1a /home/${SSH_USER}/project 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("test.txt");
			expect(result.stdout).toContain("package.json");
			expect(result.stdout).toContain("subdir");
		});

		it("should list subdirectory contents", () => {
			const result = sshExec(`ls -1a /home/${SSH_USER}/project/subdir 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain("nested.txt");
		});

		it("should respect result limit", () => {
			const result = sshExec(`ls -1a /home/${SSH_USER}/project 2>/dev/null | head -n 3`);
			expect(result.code).toBe(0);
			const lines = result.stdout.trim().split("\n").filter(Boolean);
			expect(lines.length).toBeLessThanOrEqual(3);
		});

		it("should handle non-existent directory", () => {
			const result = sshExec(`ls /home/${SSH_USER}/project/nonexistent 2>&1`);
			expect(result.code).not.toBe(0);
			expect(result.stdout + result.stderr).toMatch(/no such file|not found|cannot access/i);
		});

		it("should show hidden files", () => {
			// Create hidden file
			sshExec(`echo "hidden" > /home/${SSH_USER}/project/.hidden`);
			const result = sshExec(`ls -1a /home/${SSH_USER}/project 2>/dev/null`);
			expect(result.code).toBe(0);
			expect(result.stdout).toContain(".hidden");
		});
	});

	describe("shell escaping", () => {
		it("should escape single quotes in paths", () => {
			const filename = "file's name.txt";
			const escapedFilename = escapeForShell(filename);

			// Create file
			sshExec(`echo "content" > /home/${SSH_USER}/project/${escapedFilename}`);

			// Read file
			const result = sshExec(`cat /home/${SSH_USER}/project/${escapedFilename}`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("content");
		});

		it("should escape dollar signs", () => {
			const content = "Price: $100";
			const base64 = Buffer.from(content).toString("base64");
			sshExec(`printf '%s' '${base64}' | base64 -d > /home/${SSH_USER}/project/dollar.txt`);

			const result = sshExec(`cat /home/${SSH_USER}/project/dollar.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});

		it("should escape backticks", () => {
			const content = "Command: `ls`";
			const base64 = Buffer.from(content).toString("base64");
			sshExec(`printf '%s' '${base64}' | base64 -d > /home/${SSH_USER}/project/backtick.txt`);

			const result = sshExec(`cat /home/${SSH_USER}/project/backtick.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(content);
		});
	});

	describe("remote cwd handling", () => {
		it("should execute commands relative to cwd", () => {
			// Simulate remoteCwd by prefixing with cd
			const remoteCwd = `/home/${SSH_USER}/project`;
			const result = sshExec(`cd ${escapeForShell(remoteCwd)} && ls test.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("test.txt");
		});

		it("should handle cwd with spaces", () => {
			// Create directory with spaces
			sshExec(`mkdir -p '/home/${SSH_USER}/project/dir with spaces'`);
			sshExec(`echo "spaced" > '/home/${SSH_USER}/project/dir with spaces/file.txt'`);

			const remoteCwd = `/home/${SSH_USER}/project/dir with spaces`;
			const result = sshExec(`cd ${escapeForShell(remoteCwd)} && cat file.txt`);
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe("spaced");
		});
	});
});
