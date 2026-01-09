/**
 * True E2E tests for pi-ssh-remote using tmux and Docker
 *
 * These tests:
 * 1. Start an Ubuntu container with SSH enabled
 * 2. Launch pi inside a tmux session
 * 3. Test all built-in tools via the extension
 * 4. Verify all operations happen on the remote filesystem (not local)
 *
 * IMPORTANT NOTES:
 * - The bash tool is SSH-wrapped and always operates on remote
 * - File tools (read, write, edit, ls, grep, find) require SSHFS mount to work on remote
 * - In print mode (-p), pi's auto-mount has a known limitation where file tools
 *   capture cwd BEFORE session_start runs, so they operate on local filesystem
 * - For proper SSHFS testing, we pre-mount the filesystem and run pi from the mount
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";

const DOCKER_IMAGE = "pi-e2e-ubuntu";
const TMUX_SESSION_PREFIX = "pi-e2e";

// Project root (where the extension lives)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Test configuration
interface TestConfig {
	sshPort: number;
	dockerContainer: string;
	tmuxSession: string;
	tempDir: string;
	sshKeyPath: string;
	localTestDir: string;
	remoteTestDir: string;
	mountPoint: string;
}

let config: TestConfig;

/**
 * Get an available port on localhost
 */
function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				server.close(() => resolve(addr.port));
			} else {
				reject(new Error("Could not get port"));
			}
		});
	});
}

/**
 * Sleep for given milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute command and return output, ignoring errors
 */
function execSafe(cmd: string, options?: { timeout?: number }): string {
	try {
		return execSync(cmd, { encoding: "utf-8", timeout: options?.timeout ?? 30000, stdio: "pipe" });
	} catch (err: any) {
		return err.stdout?.toString() || err.stderr?.toString() || "";
	}
}

/**
 * Check if a command exists
 */
function commandExists(cmd: string): boolean {
	try {
		execSync(`which ${cmd}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if SSHFS is available
 */
function sshfsAvailable(): boolean {
	return commandExists("sshfs");
}

/**
 * Clean up any orphaned SSHFS mounts from pi auto-mount (not our test mount)
 */
function cleanupAutoMounts(): void {
	try {
		// Only clean up pi-sshfs auto-mounts, not our test mount
		const mounts = execSafe("mount | grep 'pi-sshfs' || true");
		const mountPoints = mounts
			.split("\n")
			.filter((line) => line.includes("pi-sshfs"))
			.map((line) => {
				const match = line.match(/on ([^\s]+)/);
				return match ? match[1] : null;
			})
			.filter(Boolean) as string[];

		for (const mp of mountPoints) {
			console.log(`Cleaning up auto-mount: ${mp}`);
			execSafe(`diskutil unmount force "${mp}" 2>/dev/null || umount "${mp}" 2>/dev/null || true`);
		}
	} catch {
		// Ignore cleanup errors
	}
}

/**
 * Wait for SSH to be ready
 */
async function waitForSSH(port: number, keyPath: string, maxWaitMs = 30000): Promise<boolean> {
	const startTime = Date.now();
	while (Date.now() - startTime < maxWaitMs) {
		try {
			execSync(`ssh -i ${keyPath} -o StrictHostKeyChecking=no -o ConnectTimeout=2 -p ${port} root@localhost echo ok`, {
				stdio: "pipe",
				timeout: 5000,
			});
			return true;
		} catch {
			await sleep(500);
		}
	}
	return false;
}

/**
 * Send keys to tmux session
 */
function tmuxSendKeys(session: string, keys: string): void {
	execSync(`tmux send-keys -t ${session} ${JSON.stringify(keys)} Enter`, { stdio: "pipe" });
}

/**
 * Capture tmux pane content
 */
function tmuxCapture(session: string): string {
	return execSafe(`tmux capture-pane -t ${session} -p -S -1000`);
}

/**
 * Wait for end marker to appear in tmux output
 * The marker must appear on its own line (not as part of the command)
 */
async function waitForEndMarker(session: string, marker: string, timeoutMs = 60000): Promise<string> {
	const startTime = Date.now();

	// Wait a minimum time for the command to start executing
	await sleep(2000);

	while (Date.now() - startTime < timeoutMs) {
		const content = tmuxCapture(session);

		// Look for the marker on its own line - this means the echo command ran
		const lines = content.split("\n");
		const markerOnOwnLine = lines.some((line) => line.trim() === marker);

		if (markerOnOwnLine) {
			return content;
		}
		await sleep(500);
	}

	// Return whatever we have on timeout
	return tmuxCapture(session);
}

/**
 * Execute command on remote via SSH
 */
function remoteExec(cmd: string): string {
	return execSafe(
		`ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=no -p ${config.sshPort} root@localhost "${cmd.replace(/"/g, '\\"')}"`
	);
}

/**
 * Check if file exists on remote
 */
function remoteFileExists(remotePath: string): boolean {
	const result = remoteExec(`test -e ${remotePath} && echo EXISTS || echo MISSING`);
	return result.includes("EXISTS");
}

/**
 * Read file content from remote
 */
function remoteReadFile(remotePath: string): string {
	return remoteExec(`cat ${remotePath}`);
}

/**
 * Mount remote filesystem via SSHFS for file tool tests
 */
function mountSshfs(): boolean {
	if (!sshfsAvailable()) return false;

	try {
		fs.mkdirSync(config.mountPoint, { recursive: true });
		execSync(
			`sshfs root@localhost:${config.remoteTestDir} ${config.mountPoint} ` +
				`-p ${config.sshPort} ` +
				`-o IdentityFile=${config.sshKeyPath} ` +
				`-o StrictHostKeyChecking=no ` +
				`-o reconnect`,
			{ stdio: "pipe", timeout: 30000 }
		);
		return true;
	} catch (err) {
		console.error("SSHFS mount failed:", err);
		return false;
	}
}

/**
 * Unmount SSHFS
 */
function unmountSshfs(): void {
	try {
		execSafe(
			`diskutil unmount force "${config.mountPoint}" 2>/dev/null || umount "${config.mountPoint}" 2>/dev/null || true`
		);
	} catch {
		// ignore
	}
}

/**
 * Check if our test mount is active
 */
function isMounted(): boolean {
	const output = execSafe(`mount | grep "${config.mountPoint}" || true`);
	return output.includes(config.mountPoint);
}

describe("True E2E Tests with tmux and Docker", () => {
	beforeAll(async () => {
		// Clean up any orphaned auto-mounts from previous runs
		cleanupAutoMounts();

		// Check prerequisites
		const missing: string[] = [];
		if (!commandExists("docker")) missing.push("docker");
		if (!commandExists("tmux")) missing.push("tmux");
		if (!commandExists("pi")) missing.push("pi");

		if (missing.length > 0) {
			throw new Error(`Missing required commands: ${missing.join(", ")}`);
		}

		// Setup test configuration
		const sshPort = await getAvailablePort();

		config = {
			sshPort,
			dockerContainer: `pi-e2e-${sshPort}`,
			tmuxSession: `${TMUX_SESSION_PREFIX}-${sshPort}`,
			tempDir: fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-")),
			sshKeyPath: "",
			localTestDir: "",
			remoteTestDir: "/root/project",
			mountPoint: "",
		};

		config.sshKeyPath = path.join(config.tempDir, "id_ed25519");
		config.localTestDir = path.join(config.tempDir, "local");
		config.mountPoint = path.join(config.tempDir, "mount");

		// Create local test directory with marker files
		fs.mkdirSync(config.localTestDir, { recursive: true });
		fs.writeFileSync(path.join(config.localTestDir, "LOCAL_MARKER.txt"), "This file is LOCAL - should NOT be modified");
		fs.writeFileSync(path.join(config.localTestDir, "existing.txt"), "LOCAL existing content");

		// Generate SSH key
		execSync(`ssh-keygen -t ed25519 -N "" -f ${config.sshKeyPath}`, { stdio: "pipe" });
		const pubKey = fs.readFileSync(`${config.sshKeyPath}.pub`, "utf-8").trim();

		// Build Docker image
		const dockerfile = `
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y openssh-server && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /run/sshd /root/.ssh
RUN echo 'root:testpassword' | chpasswd
RUN sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
RUN sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
RUN echo '${pubKey}' > /root/.ssh/authorized_keys
RUN chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
RUN mkdir -p /root/project
RUN echo 'Hello from REMOTE!' > /root/project/remote_marker.txt
RUN echo 'REMOTE existing content' > /root/project/existing.txt
RUN mkdir -p /root/project/subdir && echo 'nested file' > /root/project/subdir/nested.txt
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
`;
		const dockerfilePath = path.join(config.tempDir, "Dockerfile");
		fs.writeFileSync(dockerfilePath, dockerfile);

		console.log(`Building Docker image ${DOCKER_IMAGE}...`);
		execSync(`docker build -t ${DOCKER_IMAGE} -f ${dockerfilePath} ${config.tempDir}`, { stdio: "pipe" });

		// Start container
		console.log(`Starting container ${config.dockerContainer} on port ${config.sshPort}...`);
		execSync(`docker run -d --name ${config.dockerContainer} -p ${config.sshPort}:22 ${DOCKER_IMAGE}`, {
			stdio: "pipe",
		});

		// Wait for SSH to be ready
		console.log("Waiting for SSH...");
		const sshReady = await waitForSSH(config.sshPort, config.sshKeyPath);
		if (!sshReady) {
			throw new Error("SSH did not become ready in time");
		}
		console.log("SSH is ready");

		// Verify remote setup
		const remoteContent = remoteReadFile("/root/project/remote_marker.txt");
		if (!remoteContent.includes("REMOTE")) {
			throw new Error("Remote setup verification failed");
		}
	}, 120000);

	afterAll(() => {
		// Kill any tmux sessions
		try {
			execSync(`tmux kill-server 2>/dev/null || true`, { stdio: "pipe" });
		} catch {
			// ignore
		}

		// Unmount our test mount
		unmountSshfs();

		// Clean up auto-mounts
		cleanupAutoMounts();

		// Stop and remove container
		try {
			execSync(`docker rm -f ${config?.dockerContainer} 2>/dev/null || true`, { stdio: "pipe" });
		} catch {
			// ignore
		}

		// Clean up temp directory
		if (config?.tempDir) {
			try {
				fs.rmSync(config.tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	afterEach(() => {
		// Kill tmux session after each test
		try {
			execSync(`tmux kill-session -t ${config?.tmuxSession} 2>/dev/null || true`, { stdio: "pipe" });
		} catch {
			// ignore
		}

		// Only clean up auto-mounts, not our test mount
		cleanupAutoMounts();
	});

	/**
	 * Run pi with a prompt and return the result
	 * Uses tmux to handle the session and an end marker to detect completion
	 */
	async function runPiPrompt(
		prompt: string,
		options?: { cwd?: string; timeoutMs?: number; extraArgs?: string[] }
	): Promise<string> {
		const timeoutMs = options?.timeoutMs ?? 60000;
		const cwd = options?.cwd ?? config.localTestDir;

		const sshArgs = [
			`--ssh-host root@localhost`,
			`--ssh-port ${config.sshPort}`,
			`--ssh-cwd ${config.remoteTestDir}`,
			`--ssh-command "ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=no"`,
			`--ssh-no-mount`, // Always disable auto-mount in print mode (known limitation)
		];

		// Use all available tools
		const tools = "read,bash,edit,write,grep,find,ls";

		// Escape the prompt for shell
		const escapedPrompt = prompt.replace(/'/g, "'\\''");

		// Generate a unique marker for this invocation
		const marker = `DONE_${Date.now()}_${Math.random().toString(36).substring(7)}`;

		// Build command
		const piCmd = [
			`cd ${cwd}`,
			`&&`,
			`pi`,
			`-e ${PROJECT_ROOT}`,
			`--tools ${tools}`,
			`--no-session`,
			...sshArgs,
			...(options?.extraArgs || []),
			`-p '${escapedPrompt}'`,
			`&&`,
			`echo '${marker}'`,
			`||`,
			`echo '${marker}'`,
		].join(" ");

		// Create tmux session with unique name per invocation
		const session = `${config.tmuxSession}-${Date.now()}`;
		execSync(`tmux new-session -d -s ${session} -x 200 -y 50`, { stdio: "pipe" });

		try {
			// Run pi command
			tmuxSendKeys(session, piCmd);

			// Wait for end marker
			const output = await waitForEndMarker(session, marker, timeoutMs);
			return output;
		} finally {
			// Clean up this session
			try {
				execSync(`tmux kill-session -t ${session} 2>/dev/null || true`, { stdio: "pipe" });
			} catch {
				// ignore
			}
		}
	}

	describe("bash tool (remote execution)", () => {
		it("should execute commands on remote, not local", async () => {
			const output = await runPiPrompt("Use bash to run: pwd && cat remote_marker.txt");

			// Should show remote path
			expect(output).toContain("/root/project");
			// Should show remote content
			expect(output).toContain("Hello from REMOTE!");
		}, 90000);

		it("should create files on remote via bash", async () => {
			const testFile = `bash_created_${Date.now()}.txt`;
			const testContent = "Created via bash";

			await runPiPrompt(`Use bash to run: echo '${testContent}' > ${testFile}`);

			// Verify file exists on remote
			expect(remoteFileExists(`/root/project/${testFile}`)).toBe(true);
			expect(remoteReadFile(`/root/project/${testFile}`).trim()).toBe(testContent);

			// Verify file does NOT exist locally
			const localPath = path.join(config.localTestDir, testFile);
			expect(fs.existsSync(localPath)).toBe(false);
		}, 90000);

		it("should list remote directory contents via bash", async () => {
			const output = await runPiPrompt("Use bash to run: ls -la");

			// Should see remote files
			expect(output).toContain("remote_marker.txt");
			expect(output).toContain("existing.txt");
			expect(output).toContain("subdir");
		}, 90000);

		it("should NOT show local files in remote listing", async () => {
			const output = await runPiPrompt("Use bash to run: ls -la");

			// Should NOT see local marker
			expect(output).not.toContain("LOCAL_MARKER.txt");
		}, 90000);
	});

	describe("file operations on remote", () => {
		it("should handle remote command failures gracefully", async () => {
			const output = await runPiPrompt("Use bash to run: cat /nonexistent_file_xyz.txt");

			// Should show error or indicate file doesn't exist (not crash)
			expect(output.toLowerCase()).toMatch(/no such file|error|not found|cannot|does not exist|failed/i);
		}, 90000);

		it("should handle exit codes correctly", async () => {
			const output = await runPiPrompt("Use bash to run: false");

			// Should handle the non-zero exit
			expect(output).toBeDefined();
			expect(output.length).toBeGreaterThan(0);
		}, 90000);
	});

	describe("remote file manipulation via bash", () => {
		it("should append to remote files without affecting local", async () => {
			// Record local state before test
			const localExistingBefore = fs.readFileSync(path.join(config.localTestDir, "existing.txt"), "utf-8");

			await runPiPrompt("Use bash to run: echo 'APPENDED' >> existing.txt");

			// Verify remote was modified
			const remoteExisting = remoteReadFile("/root/project/existing.txt");
			expect(remoteExisting).toContain("APPENDED");

			// Verify local file is UNCHANGED
			const localExistingAfter = fs.readFileSync(path.join(config.localTestDir, "existing.txt"), "utf-8");
			expect(localExistingAfter).toBe(localExistingBefore);
			expect(localExistingAfter).not.toContain("APPENDED");
		}, 90000);

		it("should keep local and remote filesystems completely separate", async () => {
			// Create unique file on remote
			const remoteOnlyFile = `remote_only_${Date.now()}.txt`;
			remoteExec(`echo 'REMOTE ONLY CONTENT' > /root/project/${remoteOnlyFile}`);

			// Verify remote file exists
			expect(remoteFileExists(`/root/project/${remoteOnlyFile}`)).toBe(true);

			// Run pi and access the file via bash
			const output = await runPiPrompt(`Use bash to cat ${remoteOnlyFile}`);

			expect(output).toContain("REMOTE ONLY CONTENT");

			// Verify local directory does NOT have this file
			const localPath = path.join(config.localTestDir, remoteOnlyFile);
			expect(fs.existsSync(localPath)).toBe(false);

			// List local directory to verify it's unchanged
			const localFiles = fs.readdirSync(config.localTestDir);
			expect(localFiles).toContain("LOCAL_MARKER.txt");
			expect(localFiles).toContain("existing.txt");
			expect(localFiles).not.toContain(remoteOnlyFile);
		}, 90000);
	});

	// Tests that require SSHFS - run pi from the mount point
	const describeWithSshfs = sshfsAvailable() ? describe : describe.skip;

	describeWithSshfs("SSHFS-based file tools (via pre-mounted SSHFS)", () => {
		// Mount SSHFS before these tests and keep it mounted throughout
		beforeAll(() => {
			if (!isMounted()) {
				const mounted = mountSshfs();
				if (!mounted) {
					throw new Error("Failed to mount SSHFS for file tool tests");
				}
				console.log(`SSHFS mounted at ${config.mountPoint}`);
			}
		});

		// Don't unmount between tests - let afterAll handle it

		it("should read remote files via read tool when running from mount", async () => {
			// Verify mount is active
			expect(isMounted()).toBe(true);

			// Run pi FROM the mount point, so file tools operate on remote files
			const output = await runPiPrompt("Use the read tool to read existing.txt", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Should show REMOTE content (file in the mount has remote content)
			expect(output).toContain("REMOTE existing content");
		}, 150000);

		it("should write remote files via write tool when running from mount", async () => {
			expect(isMounted()).toBe(true);

			const filename = `write_test_${Date.now()}.txt`;
			const content = "Written via write tool";

			await runPiPrompt(`Use the write tool to create a file called ${filename} with content: ${content}`, {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Give SSHFS time to sync
			await sleep(2000);

			// Verify file exists on remote
			expect(remoteFileExists(`/root/project/${filename}`)).toBe(true);
			const remoteContent = remoteReadFile(`/root/project/${filename}`).trim();
			expect(remoteContent).toBe(content);

			// Verify file does NOT exist in local test dir
			const localPath = path.join(config.localTestDir, filename);
			expect(fs.existsSync(localPath)).toBe(false);
		}, 150000);

		it("should list remote directory via ls tool when running from mount", async () => {
			expect(isMounted()).toBe(true);

			const output = await runPiPrompt("Use the ls tool to list the current directory", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Should see remote files
			expect(output).toContain("remote_marker.txt");
			expect(output).toContain("subdir");
			// Should NOT see local marker (it's not in the remote dir)
			expect(output).not.toContain("LOCAL_MARKER.txt");
		}, 150000);

		it("should search remote files via grep tool when running from mount", async () => {
			expect(isMounted()).toBe(true);

			const output = await runPiPrompt("Use the grep tool to search for 'REMOTE' in all txt files", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Should find matches in remote files
			expect(output).toContain("REMOTE");
		}, 150000);

		it("should find remote files via find tool when running from mount", async () => {
			expect(isMounted()).toBe(true);

			const output = await runPiPrompt("Use the find tool to find all txt files", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Should find remote files
			expect(output).toContain("remote_marker.txt");
		}, 150000);

		it("should edit remote files via edit tool when running from mount", async () => {
			expect(isMounted()).toBe(true);

			// First create a file on remote
			const filename = `edit_test_${Date.now()}.txt`;
			remoteExec(`echo 'ORIGINAL content here' > /root/project/${filename}`);

			// Wait for mount to see the file
			await sleep(1000);

			await runPiPrompt(`Use the edit tool to modify ${filename}, changing 'ORIGINAL' to 'EDITED'`, {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			// Give SSHFS time to sync
			await sleep(2000);

			// Verify remote file was edited
			const remoteContent = remoteReadFile(`/root/project/${filename}`);
			expect(remoteContent).toContain("EDITED");
			expect(remoteContent).not.toContain("ORIGINAL");
		}, 150000);
	});

	describe("local filesystem protection", () => {
		it("should never have modified local marker file", () => {
			const content = fs.readFileSync(path.join(config.localTestDir, "LOCAL_MARKER.txt"), "utf-8");
			expect(content).toBe("This file is LOCAL - should NOT be modified");
		});

		it("should verify all test files remain local only", () => {
			const localFiles = fs.readdirSync(config.localTestDir);

			// Should still have our local files
			expect(localFiles).toContain("LOCAL_MARKER.txt");
			expect(localFiles).toContain("existing.txt");

			// Should NOT have any remote-created files
			expect(localFiles).not.toContain("remote_marker.txt");
			expect(localFiles).not.toContain("subdir");
		});
	});
});
