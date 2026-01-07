# pi-ssh-remote

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that redirects all file operations and commands to a remote host via SSH. This allows you to run pi locally while having it operate on a remote machine.

## Installation

### Option 1: Clone to extensions directory (recommended)

```bash
# Global installation (all projects)
git clone https://github.com/cv/pi-ssh-remote ~/.pi/agent/extensions/pi-ssh-remote

# Or project-local installation
git clone https://github.com/cv/pi-ssh-remote .pi/extensions/pi-ssh-remote
```

### Option 2: Add to settings.json

Clone the repository anywhere, then add the path to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-ssh-remote"]
}
```

### Option 3: Load manually with CLI flag

```bash
pi -e /path/to/pi-ssh-remote/ssh-remote.ts
```

## Usage

### Important: Disable conflicting built-in tools

This extension registers tools named `bash`, `read`, `write`, `edit`, `grep`, `find`, and `ls` which conflict with pi's built-in tools of the same names. You must disable the built-in versions to avoid duplicate tool errors:

```bash
# Disable all built-in tools (extension provides SSH-wrapped versions)
pi --tools '' -e ./ssh-remote.ts
```

### Configure via command

Once pi starts with the extension loaded, use the `/ssh` command:

```
/ssh user@example.com              # Set remote host
/ssh user@example.com /path/to/dir # Set remote host + working directory
/ssh port 2222                     # Set custom port
/ssh command tsh ssh               # Set custom SSH command (e.g., Teleport)
/ssh                               # Show current configuration
/ssh off                           # Disable remote mode
```

### Configure via CLI flags

You can also configure the SSH remote directly from the command line:

```bash
pi --tools '' -e ./ssh-remote.ts --ssh-host user@example.com
pi --tools '' -e ./ssh-remote.ts --ssh-host user@example.com --ssh-cwd /path/to/project
pi --tools '' -e ./ssh-remote.ts --ssh-host user@example.com --ssh-port 2222
pi --tools '' -e ./ssh-remote.ts --ssh-host user@example.com --ssh-command "tsh ssh"
```

### Example session

```bash
# Start pi with the extension and SSH preconfigured
pi --tools '' -e ./ssh-remote.ts --ssh-host myuser@myserver.com --ssh-cwd /home/myuser/project

# With custom port:
pi --tools '' -e ./ssh-remote.ts --ssh-host myuser@myserver.com --ssh-port 2222

# With Teleport:
pi --tools '' -e ./ssh-remote.ts --ssh-host myuser@myserver.com --ssh-command "tsh ssh"

# Or start without SSH and configure later with /ssh command:
pi --tools '' -e ./ssh-remote.ts
# Then in pi:
/ssh myuser@myserver.com /home/myuser/project
/ssh port 2222
```

## Features

- **Provides SSH-wrapped tools**:
  - `bash` - Executes commands on the remote host
  - `read` - Reads files from the remote host
  - `write` - Writes files to the remote host
  - `edit` - Edits files on the remote host
  - `grep` - Searches file contents on the remote host
  - `find` - Finds files by name pattern on the remote host
  - `ls` - Lists directory contents on the remote host

- **Session persistence** - Configuration persists across session reloads and branching

- **UI integration**:
  - Shows status in footer: `🔗 SSH: user@host:port (cwd) [command]`
  - Tool calls show `[user@host]` prefix
  - Tool results show `[remote]` prefix

- **Flexible connection options**:
  - Custom port via `--ssh-port` or `/ssh port`
  - Custom SSH command via `--ssh-command` or `/ssh command` (for Teleport, bastion hosts, etc.)

- **Large file support** - Uses chunked base64 encoding for files that exceed shell argument limits

- **Proper shell escaping** - Handles special characters in paths and content

- **Smart tool detection** - Auto-detects `rg` (ripgrep) and `fd` on the remote host and uses them when available, falling back to standard `grep` and `find` otherwise

## Requirements

- SSH access to the remote host (key-based authentication recommended for seamless operation)
- Remote host must have standard utilities: `cat`, `sed`, `mkdir`, `base64`

## How it works

When SSH remote is configured, the extension wraps tool operations with SSH:

| Tool | Remote execution |
|------|------------------|
| `bash` with `ls -la` | `ssh user@host 'cd /remote/cwd && ls -la'` |
| `read` of `file.txt` | `ssh user@host 'cd /remote/cwd && cat file.txt'` |
| `write` to `file.txt` | `ssh user@host 'cd /remote/cwd && printf ... \| base64 -d > file.txt'` |
| `edit` of `file.txt` | Read via SSH, modify locally, write back via SSH |

For write operations, content is base64-encoded to safely pass through the shell and handle binary data.

## Limitations

- **No image support for remote read** - Images cannot be displayed inline when reading from remote. The file will be read as text.
- **No streaming for large outputs** - Output is collected and returned after command completes.
- **SSH connection per command** - Each tool call establishes a new SSH connection. Consider using SSH connection multiplexing (`ControlMaster`) for better performance.
- **Tool name conflicts** - Must disable all built-in tools using `--tools ''` flag.


## Recommended SSH config for performance

Add to your `~/.ssh/config`:

```
Host your-server
    HostName example.com
    User youruser
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
```

Then create the sockets directory:

```bash
mkdir -p ~/.ssh/sockets
```

This keeps SSH connections open for 10 minutes, making subsequent commands much faster.

## Troubleshooting

### "Tool names must be unique" error

This occurs when both the extension's tools and pi's built-in tools are loaded. Solution:

```bash
pi --tools '' -e ./ssh-remote.ts
```

### Model says it's in "READ-ONLY mode"

The model may incorrectly assume it's read-only if the conversation context suggests limited tools. Simply instruct the model that it has write and edit capabilities, or start a fresh session.

### SSH connection failures

Ensure:
1. You can SSH to the host manually: `ssh user@host`
2. Key-based authentication is set up (password prompts won't work in non-interactive mode)
3. The host alias (if using SSH config) is correctly configured

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and testing instructions.

## License

MIT
