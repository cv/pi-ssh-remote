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

### Configure via command

Once pi starts with the extension loaded:

```
/ssh user@example.com              # Set remote host
/ssh user@example.com /path/to/dir # Set remote host + working directory
/ssh                               # Show current configuration
/ssh off                           # Disable remote mode
```

### Configure via CLI flags

```bash
pi --ssh-host user@example.com
pi --ssh-host user@example.com --ssh-cwd /path/to/project
```

## Features

- **Replaces built-in tools** with SSH-wrapped versions:
  - `bash` - Executes commands on the remote host
  - `read` - Reads files from the remote host
  - `write` - Writes files to the remote host
  - `edit` - Edits files on the remote host

- **Session persistence** - Configuration persists across session reloads and branching

- **UI integration**:
  - Shows status in footer: `🔗 SSH: user@host (cwd)`
  - Tool calls show `[user@host]` prefix
  - Tool results show `[remote]` prefix

- **Large file support** - Uses chunked base64 encoding for files that exceed shell argument limits

- **Proper shell escaping** - Handles special characters in paths and content

## Requirements

- SSH access to the remote host (key-based authentication recommended for seamless operation)
- Remote host must have standard utilities: `cat`, `sed`, `mkdir`, `base64`

## How it works

When SSH remote is configured, the extension intercepts all tool calls and wraps them with SSH:

| Local command | Remote equivalent |
|---------------|-------------------|
| `cat file.txt` | `ssh user@host 'cat file.txt'` |
| `echo "content" > file.txt` | `ssh user@host 'echo "base64..." \| base64 -d > file.txt'` |
| `ls -la` | `ssh user@host 'cd /remote/cwd && ls -la'` |

For write operations, content is base64-encoded to safely pass through the shell and handle binary data.

## Limitations

- **No image support for remote read** - Images cannot be displayed inline when reading from remote. The file will be read as text.
- **No streaming for large outputs** - Output is collected and returned after command completes.
- **SSH connection per command** - Each tool call establishes a new SSH connection. Consider using SSH connection multiplexing (`ControlMaster`) for better performance.

### Recommended SSH config for performance

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

## License

MIT
