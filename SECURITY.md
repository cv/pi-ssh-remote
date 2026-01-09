# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please email the repository maintainer. **Do not report security vulnerabilities through public GitHub issues.**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Expect an initial response within 48 hours.

---

## Security Model

### How It Works

pi-ssh-remote uses two mechanisms:

1. **SSHFS**: Mounts remote filesystem locally via SSH
2. **SSH**: Executes bash commands on the remote host

```
┌──────────────┐       SSH/SSHFS      ┌──────────────┐
│  Local Host  │ ◄──────────────────► │ Remote Host  │
│              │                      │              │
│  pi agent    │                      │  Files       │
│  SSHFS mount │                      │  Commands    │
└──────────────┘                      └──────────────┘
```

### What You're Trusting

| Entity | Trust |
|--------|-------|
| **The LLM** | To generate safe commands |
| **The pi agent** | To execute requests faithfully |
| **The remote host** | To execute commands as expected |
| **Your SSH config** | To authenticate to intended hosts |
| **SSHFS** | To securely mount remote filesystems |

### Security Implications

⚠️ **Remote Command Execution**: The `bash` tool executes arbitrary commands on the remote host.

⚠️ **Data Exposure**: File contents are sent to the LLM provider. Don't use with sensitive data.

⚠️ **SSHFS Mount**: The remote filesystem is mounted locally. Any process on your machine can access it while mounted.

⚠️ **Host Key Verification (TOFU)**: By default, pi-ssh-remote uses `StrictHostKeyChecking=accept-new`, which automatically accepts and remembers host keys on first connection (Trust On First Use). This is convenient but vulnerable to man-in-the-middle attacks on the first connection to a new host. For security-sensitive environments, use `--ssh-strict-host-key` to require hosts to be in your `known_hosts` file.

---

## Best Practices

1. **Use dedicated SSH keys** for pi-ssh-remote
2. **Limit remote user permissions** to only what's needed
3. **Review commands** before execution on production systems
4. **Unmount when done** (the `pi-ssh` wrapper does this automatically)
5. **Use `--ssh-strict-host-key`** in production/sensitive environments to prevent MITM attacks
6. **Pre-verify host keys** by connecting manually before using pi-ssh-remote with strict mode
