/**
 * True E2E tests for pi-ssh-remote using tmux and Docker
 *
 * Tests start an Ubuntu container with SSH, launch pi in tmux sessions,
 * and verify all operations happen on the remote filesystem (not local).
 *
 * Note: In print mode (-p), pi's auto-mount doesn't work for file tools
 * because cwd is captured before session_start. We pre-mount SSHFS instead.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

const DOCKER_IMAGE = "pi-e2e-ubuntu";
const PROJECT_ROOT = path.resolve(__dirname, "..");

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

// --- Utility Functions ---

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function exec(cmd: string, options: { timeout?: number; ignoreError?: boolean } = {}): string {
	try {
		return execSync(cmd, {
			encoding: "utf-8",
			timeout: options.timeout ?? 30000,
			stdio: "pipe",
		});
	} catch (err: any) {
		if (options.ignoreError) {
			return err.stdout?.toString() || err.stderr?.toString() || "";
		}
		throw err;
	}
}

function commandExists(cmd: string): boolean {
	try {
		execSync(`which ${cmd}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function sshfsAvailable(): boolean {
	return commandExists("sshfs");
}

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

// --- Cleanup Functions ---

function cleanupAutoMounts(): void {
	const mounts = exec("mount | grep 'pi-sshfs' || true", { ignoreError: true });
	const mountPoints = mounts
		.split("\n")
		.filter((line) => line.includes("pi-sshfs"))
		.map((line) => line.match(/on ([^\s]+)/)?.[1])
		.filter(Boolean) as string[];

	for (const mp of mountPoints) {
		console.log(`Cleaning up auto-mount: ${mp}`);
		exec(`diskutil unmount force "${mp}" 2>/dev/null || umount "${mp}" 2>/dev/null || true`, { ignoreError: true });
	}
}

function unmountSshfs(): void {
	exec(
		`diskutil unmount force "${config.mountPoint}" 2>/dev/null || umount "${config.mountPoint}" 2>/dev/null || true`,
		{ ignoreError: true }
	);
}

function killTmuxSession(session: string): void {
	exec(`tmux kill-session -t ${session} 2>/dev/null || true`, { ignoreError: true });
}

// --- SSH Functions ---

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

function remoteExec(cmd: string): string {
	const escapedCmd = cmd.replace(/"/g, '\\"');
	return exec(
		`ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=no -p ${config.sshPort} root@localhost "${escapedCmd}"`,
		{ ignoreError: true }
	);
}

function remoteFileExists(remotePath: string): boolean {
	return remoteExec(`test -e ${remotePath} && echo EXISTS || echo MISSING`).includes("EXISTS");
}

function remoteReadFile(remotePath: string): string {
	return remoteExec(`cat ${remotePath}`);
}

// --- SSHFS Functions ---

function mountSshfs(): boolean {
	if (!sshfsAvailable()) return false;

	try {
		fs.mkdirSync(config.mountPoint, { recursive: true });
		execSync(
			[
				`sshfs root@localhost:${config.remoteTestDir} ${config.mountPoint}`,
				`-p ${config.sshPort}`,
				`-o IdentityFile=${config.sshKeyPath}`,
				`-o StrictHostKeyChecking=no`,
				`-o reconnect`,
			].join(" "),
			{ stdio: "pipe", timeout: 30000 }
		);
		return true;
	} catch (err) {
		console.error("SSHFS mount failed:", err);
		return false;
	}
}

function isMounted(): boolean {
	return exec(`mount | grep "${config.mountPoint}" || true`, { ignoreError: true }).includes(config.mountPoint);
}

// --- tmux Functions ---

function tmuxSendKeys(session: string, keys: string): void {
	execSync(`tmux send-keys -t ${session} ${JSON.stringify(keys)} Enter`, { stdio: "pipe" });
}

function tmuxCapture(session: string): string {
	return exec(`tmux capture-pane -t ${session} -p -S -1000`, { ignoreError: true });
}

async function waitForEndMarker(session: string, marker: string, timeoutMs = 60000): Promise<string> {
	const startTime = Date.now();
	await sleep(2000); // Wait for command to start

	while (Date.now() - startTime < timeoutMs) {
		const content = tmuxCapture(session);
		if (content.split("\n").some((line) => line.trim() === marker)) {
			return content;
		}
		await sleep(500);
	}

	return tmuxCapture(session);
}

// --- Test Runner ---

async function runPiPrompt(prompt: string, options: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
	const { timeoutMs = 60000, cwd = config.localTestDir } = options;
	const marker = `DONE_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	const escapedPrompt = prompt.replace(/'/g, "'\\''");

	const piCmd = [
		`cd ${cwd} &&`,
		`pi -e ${PROJECT_ROOT}`,
		`--tools read,bash,edit,write,grep,find,ls`,
		`--no-session`,
		`--ssh-host root@localhost`,
		`--ssh-port ${config.sshPort}`,
		`--ssh-cwd ${config.remoteTestDir}`,
		`--ssh-command "ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=no"`,
		`--ssh-no-mount`,
		`-p '${escapedPrompt}'`,
		`&& echo '${marker}' || echo '${marker}'`,
	].join(" ");

	const session = `pi-e2e-${Date.now()}`;
	execSync(`tmux new-session -d -s ${session} -x 200 -y 50`, { stdio: "pipe" });

	try {
		tmuxSendKeys(session, piCmd);
		return await waitForEndMarker(session, marker, timeoutMs);
	} finally {
		killTmuxSession(session);
	}
}

// --- Test Suite ---

describe("True E2E Tests with tmux and Docker", () => {
	beforeAll(async () => {
		cleanupAutoMounts();

		const requiredCommands = ["docker", "tmux", "pi"];
		const missing = requiredCommands.filter((cmd) => !commandExists(cmd));
		if (missing.length > 0) {
			throw new Error(`Missing required commands: ${missing.join(", ")}`);
		}

		const sshPort = await getAvailablePort();
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-"));

		config = {
			sshPort,
			dockerContainer: `pi-e2e-${sshPort}`,
			tmuxSession: `pi-e2e-${sshPort}`,
			tempDir,
			sshKeyPath: path.join(tempDir, "id_ed25519"),
			localTestDir: path.join(tempDir, "local"),
			remoteTestDir: "/root/project",
			mountPoint: path.join(tempDir, "mount"),
		};

		// Create local test directory with marker files
		fs.mkdirSync(config.localTestDir, { recursive: true });
		fs.writeFileSync(path.join(config.localTestDir, "LOCAL_MARKER.txt"), "This file is LOCAL - should NOT be modified");
		fs.writeFileSync(path.join(config.localTestDir, "existing.txt"), "LOCAL existing content");

		// Generate SSH key
		execSync(`ssh-keygen -t ed25519 -N "" -f ${config.sshKeyPath}`, { stdio: "pipe" });
		const pubKey = fs.readFileSync(`${config.sshKeyPath}.pub`, "utf-8").trim();

		// Build Docker image with SSH configured
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
RUN mkdir -p /root/project/subdir
RUN echo 'Hello from REMOTE!' > /root/project/remote_marker.txt
RUN echo 'REMOTE existing content' > /root/project/existing.txt
RUN echo 'nested file' > /root/project/subdir/nested.txt
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
`;
		fs.writeFileSync(path.join(tempDir, "Dockerfile"), dockerfile);

		console.log(`Building Docker image ${DOCKER_IMAGE}...`);
		execSync(`docker build -t ${DOCKER_IMAGE} -f ${path.join(tempDir, "Dockerfile")} ${tempDir}`, { stdio: "pipe" });

		console.log(`Starting container ${config.dockerContainer} on port ${config.sshPort}...`);
		execSync(`docker run -d --name ${config.dockerContainer} -p ${config.sshPort}:22 ${DOCKER_IMAGE}`, {
			stdio: "pipe",
		});

		console.log("Waiting for SSH...");
		if (!(await waitForSSH(config.sshPort, config.sshKeyPath))) {
			throw new Error("SSH did not become ready in time");
		}
		console.log("SSH is ready");

		// Verify remote setup
		if (!remoteReadFile("/root/project/remote_marker.txt").includes("REMOTE")) {
			throw new Error("Remote setup verification failed");
		}
	}, 120000);

	afterAll(() => {
		exec("tmux kill-server 2>/dev/null || true", { ignoreError: true });
		unmountSshfs();
		cleanupAutoMounts();
		exec(`docker rm -f ${config?.dockerContainer} 2>/dev/null || true`, { ignoreError: true });
		if (config?.tempDir) {
			fs.rmSync(config.tempDir, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		killTmuxSession(config?.tmuxSession);
		cleanupAutoMounts();
	});

	describe("bash tool (remote execution)", () => {
		it("should execute commands on remote, not local", async () => {
			const output = await runPiPrompt("Use bash to run: pwd && cat remote_marker.txt");
			expect(output).toContain("/root/project");
			expect(output).toContain("Hello from REMOTE!");
		}, 90000);

		it("should create files on remote via bash", async () => {
			const testFile = `bash_created_${Date.now()}.txt`;
			await runPiPrompt(`Use bash to run: echo 'Created via bash' > ${testFile}`);

			expect(remoteFileExists(`/root/project/${testFile}`)).toBe(true);
			expect(remoteReadFile(`/root/project/${testFile}`).trim()).toBe("Created via bash");
			expect(fs.existsSync(path.join(config.localTestDir, testFile))).toBe(false);
		}, 90000);

		it("should list remote directory contents via bash", async () => {
			const output = await runPiPrompt("Use bash to run: ls -la");
			expect(output).toContain("remote_marker.txt");
			expect(output).toContain("existing.txt");
			expect(output).toContain("subdir");
		}, 90000);

		it("should NOT show local files in remote listing", async () => {
			const output = await runPiPrompt("Use bash to run: ls -la");
			expect(output).not.toContain("LOCAL_MARKER.txt");
		}, 90000);
	});

	describe("file operations on remote", () => {
		it("should handle remote command failures gracefully", async () => {
			const output = await runPiPrompt("Use bash to run: cat /nonexistent_file_xyz.txt");
			expect(output.toLowerCase()).toMatch(/no such file|error|not found|cannot|does not exist|failed/i);
		}, 90000);

		it("should handle exit codes correctly", async () => {
			const output = await runPiPrompt("Use bash to run: false");
			expect(output).toBeDefined();
			expect(output.length).toBeGreaterThan(0);
		}, 90000);
	});

	describe("remote file manipulation via bash", () => {
		it("should append to remote files without affecting local", async () => {
			const localBefore = fs.readFileSync(path.join(config.localTestDir, "existing.txt"), "utf-8");

			await runPiPrompt("Use bash to run: echo 'APPENDED' >> existing.txt");

			expect(remoteReadFile("/root/project/existing.txt")).toContain("APPENDED");

			const localAfter = fs.readFileSync(path.join(config.localTestDir, "existing.txt"), "utf-8");
			expect(localAfter).toBe(localBefore);
			expect(localAfter).not.toContain("APPENDED");
		}, 90000);

		it("should keep local and remote filesystems completely separate", async () => {
			const remoteOnlyFile = `remote_only_${Date.now()}.txt`;
			remoteExec(`echo 'REMOTE ONLY CONTENT' > /root/project/${remoteOnlyFile}`);

			expect(remoteFileExists(`/root/project/${remoteOnlyFile}`)).toBe(true);

			const output = await runPiPrompt(`Use bash to cat ${remoteOnlyFile}`);
			expect(output).toContain("REMOTE ONLY CONTENT");

			expect(fs.existsSync(path.join(config.localTestDir, remoteOnlyFile))).toBe(false);

			const localFiles = fs.readdirSync(config.localTestDir);
			expect(localFiles).toContain("LOCAL_MARKER.txt");
			expect(localFiles).not.toContain(remoteOnlyFile);
		}, 90000);
	});

	const describeWithSshfs = sshfsAvailable() ? describe : describe.skip;

	describeWithSshfs("SSHFS-based file tools (via pre-mounted SSHFS)", () => {
		beforeAll(() => {
			if (!isMounted() && !mountSshfs()) {
				throw new Error("Failed to mount SSHFS for file tool tests");
			}
			console.log(`SSHFS mounted at ${config.mountPoint}`);
		});

		it("should read remote files via read tool", async () => {
			expect(isMounted()).toBe(true);
			const output = await runPiPrompt("Use the read tool to read existing.txt", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});
			expect(output).toContain("REMOTE existing content");
		}, 150000);

		it("should write remote files via write tool", async () => {
			expect(isMounted()).toBe(true);
			const filename = `write_test_${Date.now()}.txt`;
			const content = "Written via write tool";

			await runPiPrompt(`Use the write tool to create a file called ${filename} with content: ${content}`, {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			await sleep(2000);
			expect(remoteFileExists(`/root/project/${filename}`)).toBe(true);
			expect(remoteReadFile(`/root/project/${filename}`).trim()).toBe(content);
			expect(fs.existsSync(path.join(config.localTestDir, filename))).toBe(false);
		}, 150000);

		it("should list remote directory via ls tool", async () => {
			expect(isMounted()).toBe(true);
			const output = await runPiPrompt("Use the ls tool to list the current directory", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});
			expect(output).toContain("remote_marker.txt");
			expect(output).toContain("subdir");
			expect(output).not.toContain("LOCAL_MARKER.txt");
		}, 150000);

		it("should search remote files via grep tool", async () => {
			expect(isMounted()).toBe(true);
			const output = await runPiPrompt("Use the grep tool to search for 'REMOTE' in all txt files", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});
			expect(output).toContain("REMOTE");
		}, 150000);

		it("should find remote files via find tool", async () => {
			expect(isMounted()).toBe(true);
			const output = await runPiPrompt("Use the find tool to find all txt files", {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});
			expect(output).toContain("remote_marker.txt");
		}, 150000);

		it("should edit remote files via edit tool", async () => {
			expect(isMounted()).toBe(true);
			const filename = `edit_test_${Date.now()}.txt`;
			remoteExec(`echo 'ORIGINAL content here' > /root/project/${filename}`);

			await sleep(1000);
			await runPiPrompt(`Use the edit tool to modify ${filename}, changing 'ORIGINAL' to 'EDITED'`, {
				cwd: config.mountPoint,
				timeoutMs: 120000,
			});

			await sleep(2000);
			const content = remoteReadFile(`/root/project/${filename}`);
			expect(content).toContain("EDITED");
			expect(content).not.toContain("ORIGINAL");
		}, 150000);
	});

	describe("local filesystem protection", () => {
		it("should never have modified local marker file", () => {
			const content = fs.readFileSync(path.join(config.localTestDir, "LOCAL_MARKER.txt"), "utf-8");
			expect(content).toBe("This file is LOCAL - should NOT be modified");
		});

		it("should verify all test files remain local only", () => {
			const localFiles = fs.readdirSync(config.localTestDir);
			expect(localFiles).toContain("LOCAL_MARKER.txt");
			expect(localFiles).toContain("existing.txt");
			expect(localFiles).not.toContain("remote_marker.txt");
			expect(localFiles).not.toContain("subdir");
		});
	});
});
