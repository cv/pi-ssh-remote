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

## Security Best Practices for Users

1. **Use Dedicated SSH Keys:** Create a dedicated key pair for pi-ssh-remote rather than reusing your main SSH key.

2. **Limit Remote User Permissions:** The remote user should have minimal permissions - only access to project directories needed.

3. **Use SSH Agent Forwarding Carefully:** If using `ForwardAgent`, be aware of the security implications.

4. **Monitor Remote Host Access:** Review SSH authentication logs on the remote host.

5. **Secure Session Files:** If pi stores session files, ensure they have appropriate permissions (readable only by you).

6. **Review Commands Before Execution:** When using the pi agent with this extension, review LLM-generated commands before they're executed on production systems.


