# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within pi-ssh-remote, please send an email to the repository maintainer. All security vulnerabilities will be promptly addressed.

**Please do not report security vulnerabilities through public GitHub issues.**

When reporting, please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect an initial response within 48 hours, and we aim to provide a fix or mitigation within 7 days for critical issues.

---

## Security Audit Summary

This document provides a security analysis of the pi-ssh-remote extension. The audit was conducted on January 6, 2026.

### Project Overview

pi-ssh-remote is a [pi coding agent](https://github.com/badlogic/pi-mono) extension that redirects file operations and commands to a remote host via SSH. It wraps the following tools: `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls`.

### Security Architecture

```
┌──────────────┐       SSH        ┌──────────────┐
│  Local Host  │ ───────────────► │ Remote Host  │
│  (pi agent)  │                  │  (via SSH)   │
│              │                  │              │
│  - Extension │                  │  - Commands  │
│  - pi agent  │                  │  - Files     │
└──────────────┘                  └──────────────┘
```

---

## Trust Model & Security Implications

### What This Extension Does

When you configure pi-ssh-remote with a remote host, **all file operations and commands from the pi agent are executed on that remote host**. This includes:

- **`bash`**: Executes arbitrary shell commands
- **`read`**: Reads any file the SSH user can access
- **`write`**: Creates or overwrites any file the SSH user can write to
- **`edit`**: Modifies any file the SSH user can write to
- **`grep`/`find`/`ls`**: Searches and lists files

### Who You're Trusting

By using this extension, you are trusting:

| Entity | What You're Trusting |
|--------|---------------------|
| **The LLM** | To generate safe, appropriate commands for your remote host |
| **The pi agent** | To faithfully execute the LLM's requests |
| **The remote host** | To execute commands as expected and return accurate results |
| **Your SSH configuration** | To authenticate only to intended hosts |
| **Network path** | That SSH encryption protects data in transit |

### Security Implications

⚠️ **Remote Command Execution**: The `bash` tool allows execution of arbitrary commands. An LLM could potentially execute destructive commands (`rm -rf`, `shutdown`, etc.) if instructed or manipulated to do so.

⚠️ **Data Exposure**: All file contents read via `read` or `grep` are sent to the LLM provider's API. Do not use this extension with files containing secrets, credentials, or sensitive data you wouldn't want sent to a third-party API.

⚠️ **Compromised Remote Host**: If the remote host is compromised, an attacker could:
- Observe all commands and file contents
- Return manipulated data to influence LLM behavior
- Modify files in unexpected ways

### Session Data Storage

This extension persists SSH configuration in pi's session files:

```typescript
{
    host: "user@example.com",
    remoteCwd: "/home/user/project",
    port: 2222,
    command: "tsh ssh"  // if using custom SSH command
}
```

**Note:** Session files are stored in plaintext. While no passwords are stored (key-based authentication is required), the session files contain:
- SSH username and hostname
- Remote working directory path
- Custom SSH command (if configured)
- Port number (if non-default)

Ensure your pi session directory has appropriate permissions (readable only by you). On most systems, this is `~/.pi/` or a project-local `.pi/` directory.

---

## Security Findings

### ✅ Positive Security Practices

#### 1. Shell Escaping Implementation
The extension uses a well-implemented shell escaping function:
```typescript
function escapeForShell(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
}
```
This properly handles single quotes by breaking out of the quoted string, adding an escaped quote, and re-entering the quoted string. This is the POSIX-standard approach.

#### 2. Base64 Encoding for Content Transfer
File content is base64-encoded before transmission over SSH, which:
- Prevents shell injection via file content
- Safely handles binary data
- Avoids issues with special characters

#### 3. Chunked Writes for Large Files
Large files are split into 64KB chunks to avoid shell argument length limits, preventing both failures and potential buffer-related issues.

#### 4. ESLint Security Plugin
The project uses `eslint-plugin-security` with appropriate rules enabled:
- `detect-unsafe-regex`
- `detect-buffer-noassert`
- `detect-eval-with-expression`
- `detect-pseudoRandomBytes`

#### 5. No Direct `eval()` or Dynamic Code Execution
The extension does not use `eval()`, `new Function()`, or other dynamic code execution patterns.

#### 6. TypeScript Strict Mode
The `tsconfig.json` enables `strict: true`, catching many potential type-related bugs.

#### 7. Dependency Security
- `npm audit` reports 0 vulnerabilities
- Pre-commit hooks run tests and linting
- Dependencies are dev-only (no runtime dependencies beyond peer dependencies)

#### 8. Comprehensive Test Coverage
- Unit tests mock the extension API and verify behavior
- E2E tests use a real Docker container with SSH
- Tests cover error cases and edge conditions

---

### ⚠️ Security Considerations & Potential Risks

#### 1. **Command Injection via User Input** (Medium Risk)
**Location:** Tool parameters passed to SSH commands

While shell escaping is applied to paths and some content, the `bash` tool directly passes commands:
```typescript
if (sshHost) {
    const remoteCmd = buildRemoteCommand(command);  // command is user input
    fullCommand = [...sshPrefix(), remoteCmd];
}
```

**Analysis:** This is by design - the `bash` tool is explicitly intended to execute arbitrary commands. However, this means:
- Any LLM using this tool can execute arbitrary commands on the remote host
- The extension trusts the pi agent's access controls

**Recommendation:** Document this clearly. Consider adding optional command whitelisting or a confirmation mode for sensitive operations.

#### 2. **SSH Credential Exposure** (Low Risk)
**Location:** CLI flags and session persistence

SSH host configuration is stored in session state:
```typescript
pi.appendEntry<SSHConfig>("ssh-remote-config", {
    host: sshHost,
    remoteCwd: remoteCwd,
    port: sshPort,
    command: sshCommand,
});
```

**Analysis:** While no passwords are stored (key-based auth is expected), the host/user information is persisted. Session files may be stored in plaintext.

**Recommendation:** Document that session files may contain sensitive connection details. Consider adding a flag to disable persistence.

#### 3. **No Input Validation on Patterns** (Low Risk)
**Location:** `grep` and `find` tools

User-provided patterns are passed to `grep` and `find`:
```typescript
const escapedPattern = escapeForShell(pattern);
cmd = `grep ${rgArgs.join(" ")} ${escapedPattern} ${escapeForShell(searchDir)}`;
```

**Analysis:** Patterns are properly shell-escaped, but complex regex patterns could potentially cause:
- ReDoS (Regular Expression Denial of Service)
- Long execution times on large file systems

**Recommendation:** Consider adding pattern length limits or timeouts for search operations.

#### 4. **Trust Model with Remote Host** (Informational)
**Location:** Entire extension

The extension trusts:
- The remote host's SSH server
- The remote host's shell and utilities (`cat`, `sed`, `base64`, etc.)
- The integrity of SSH key-based authentication

**Analysis:** A compromised remote host could:
- Return malicious data that could be processed by the LLM
- Observe all commands and file contents sent via SSH
- Modify files in unexpected ways

**Recommendation:** Document the trust model. Users should only connect to hosts they control and trust.

#### 5. **SSH Connection Multiplexing Recommendation** (Low Risk)
**Location:** README.md, SSH connections

The README recommends SSH connection multiplexing via `~/.ssh/config`:
```
ControlMaster auto
ControlPath ~/.ssh/sockets/%r@%h-%p
ControlPersist 600
```

**Analysis:** While this improves performance, it also:
- Keeps connections open for 10 minutes
- Creates local socket files that could be accessed by other processes

**Recommendation:** Document the security implications of connection multiplexing. Consider recommending restrictive permissions on the sockets directory (`chmod 700`).

#### 6. **No Verification of Remote Tool Availability** (Low Risk)
**Location:** `detectRemoteTools()` function

The extension detects `rg` and `fd` availability:
```typescript
const detectCmd = "command -v rg >/dev/null 2>&1 && echo 'rg:yes'...";
```

**Analysis:** A malicious remote host could report false capabilities to influence which commands are used.

**Recommendation:** This is a minor concern given the trust model, but document that tool detection trusts the remote host.

---

### 🔒 Security Questions for Maintainers

1. **Rate Limiting:** Should there be limits on how many SSH commands can be executed per minute to prevent accidental DoS of the remote host?

2. **Audit Logging:** Should commands executed via SSH be logged locally for security audit purposes?

3. **Host Allowlist:** Should there be an optional allowlist of permitted SSH hosts?

4. **Confirmation Prompts:** Should destructive operations (`write`, `edit`, `rm` via `bash`) require user confirmation?

5. **Session Encryption:** Should session files containing SSH configuration be encrypted at rest?

---

## Dependency Analysis

### Direct Dependencies (Development Only)
| Package | Purpose | Notes |
|---------|---------|-------|
| eslint-plugin-security | Security linting | ✅ Actively maintained |
| jest | Testing | ✅ Actively maintained |
| typescript | Type checking | ✅ Actively maintained |
| prettier/eslint | Code quality | ✅ Actively maintained |
| husky/lint-staged | Git hooks | ✅ Actively maintained |

### Peer Dependencies
| Package | Purpose | Notes |
|---------|---------|-------|
| @mariozechner/pi-coding-agent | Host application | Required for extension to function |

### No Runtime Dependencies
The extension has no runtime dependencies beyond the peer dependency, which significantly reduces the supply chain attack surface.

---

## Recommendations Summary

### High Priority
1. ✅ ~~Add documentation about the trust model and security implications of remote command execution~~ (see "Trust Model & Security Implications" section above)
2. ✅ ~~Document that session files may contain connection information~~ (see "Session Data Storage" section above)

### Medium Priority (Deferred)
These items are better addressed by separate pi extensions or documentation:
- Confirmation prompts for write operations
- Command execution logging for audit purposes
- SSH key security best practices

### Low Priority (Not Planned)
- Pattern length limits for grep/find
- Optional host allowlist feature
- Timeout configuration for all operations

---

## Security Best Practices for Users

1. **Use Dedicated SSH Keys:** Create a dedicated key pair for pi-ssh-remote rather than reusing your main SSH key.

2. **Limit Remote User Permissions:** The remote user should have minimal permissions - only access to project directories needed.

3. **Use SSH Agent Forwarding Carefully:** If using `ForwardAgent`, be aware of the security implications.

4. **Monitor Remote Host Access:** Review SSH authentication logs on the remote host.

5. **Secure Session Files:** If pi stores session files, ensure they have appropriate permissions (readable only by you).

6. **Review Commands Before Execution:** When using the pi agent with this extension, review LLM-generated commands before they're executed on production systems.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-06 | 1.1 | Added Trust Model & Security Implications section, Session Data Storage documentation |
| 2026-01-06 | 1.0 | Initial security audit |
