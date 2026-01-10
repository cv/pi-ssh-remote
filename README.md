# pi-ssh-remote

Seamless remote development with [pi coding agent](https://github.com/badlogic/pi-mono) via SSH.

## Quick Start

```bash
# With auto-mount (recommended)
pi -e pi-ssh-remote --ssh-host user@server --ssh-cwd /path/to/project

# Or use the wrapper script
./pi-ssh user@server:/path/to/project
```

The extension automatically:
1. Mounts the remote `--ssh-cwd` via SSHFS to a temp directory
2. Changes pi's working directory to the mount
3. Routes bash commands to the remote host via SSH
4. Unmounts on session end

## Installation

```bash
git clone https://github.com/cv/pi-ssh-remote ~/.pi/agent/extensions/pi-ssh-remote
```

Then either:
- Use the `pi-ssh` wrapper: `~/.pi/agent/extensions/pi-ssh-remote/pi-ssh user@host:/path`
- Or add to PATH: `ln -s ~/.pi/agent/extensions/pi-ssh-remote/pi-ssh ~/bin/pi-ssh`

## Usage

### Auto-mount (default)

```bash
# Basic - mounts remote path automatically
pi -e pi-ssh-remote --ssh-host user@server --ssh-cwd /home/user/project

# Custom port
pi -e pi-ssh-remote --ssh-host user@server --ssh-cwd /home/user/project --ssh-port 2222

# Custom SSH key  
pi -e pi-ssh-remote --ssh-host user@server --ssh-cwd /home/user/project \
   --ssh-command "ssh -i ~/.ssh/mykey"

# No remote path - mounts user's home directory
pi -e pi-ssh-remote --ssh-host user@server
```

### Using the wrapper script

```bash
# Basic
pi-ssh me@server:/home/me/project

# Custom port
pi-ssh me@server:/home/me/project --ssh-port 2222

# GitHub Codespaces
gh cs ssh --config >> ~/.ssh/config
pi-ssh cs.my-codespace.main:/workspaces/project
```

### Manual mount (--ssh-no-mount)

If you prefer to manage SSHFS yourself or don't have it installed:

```bash
# Mount manually
sshfs user@server:/path ~/mnt

# Run pi with auto-mount disabled
cd ~/mnt
pi -e pi-ssh-remote \
   --ssh-host user@server \
   --ssh-cwd /path \
   --ssh-no-mount

# Unmount when done
umount ~/mnt
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--ssh-host` | SSH host (e.g., `user@server`) |
| `--ssh-cwd` | Remote working directory (auto-mounted via SSHFS) |
| `--ssh-port` | SSH port (default: 22) |
| `--ssh-command` | Custom SSH command (e.g., `ssh -i ~/.ssh/mykey`) |
| `--ssh-timeout` | Timeout for SSH commands in seconds |
| `--ssh-no-mount` | Disable auto-mounting (use existing mount or bash-only) |
| `--ssh-strict-host-key` | Require known host keys (reject unknown hosts) |

## Prerequisites

**SSHFS** must be installed for auto-mount:
- macOS: `brew install macfuse && brew install gromgit/fuse/sshfs-mac`
- Linux: `apt install sshfs`

Without SSHFS, the extension still works but only `bash` commands will work remotely (file tools won't have access).

## How it works

| Tool | Execution |
|------|-----------|
| `read`, `write`, `edit`, `grep`, `find`, `ls` | Local (on SSHFS mount) |
| `bash` | Remote (via SSH) |

The auto-mount creates a temporary directory under `/tmp/pi-sshfs/` and mounts the remote path there. On session end (or Ctrl+C), the extension automatically unmounts and cleans up.

**Note on print mode (`-p`):** Auto-mount works best in interactive mode. In print mode, the working directory is captured before the extension can mount, so file tools may not see the mounted files. For print mode, either:
- Use `--ssh-no-mount` with a pre-mounted SSHFS, or
- Use bash commands to access files (e.g., `bash cat file.txt`)

## License

MIT
