# Timeout Implementation Plan

## 1. Update SSHConfig Interface
```typescript
interface SSHConfig {
    host: string | null;
    remoteCwd: string | null;
    port: number | null;
    command: string | null;
    timeout: number | null; // Add timeout to state
}
```

## 2. Add CLI Flag Registration
```typescript
pi.registerFlag("ssh-timeout", {
    description: "Default timeout in seconds for SSH operations",
    type: "string",
});
```

## 3. Update /ssh Command Handler
Add timeout subcommand:
```typescript
if (parts[0] === "timeout") {
    const timeoutValue = parseInt(parts[1], 10);
    if (isNaN(timeoutValue) || timeoutValue < 1) {
        ctx.ui.notify("Invalid timeout. Use: /ssh timeout <seconds>", "error");
        return;
    }
    sshTimeout = timeoutValue;
    persistState();
    updateStatus(ctx);
    ctx.ui.notify(`SSH timeout set to: ${timeoutValue} seconds`, "info");
    return;
}
```

## 4. Add Timeout to All Tools
Each tool (read, write, edit, grep, find, ls) needs:
- `timeout` parameter in schema
- Application of timeout in exec calls

## 5. Update Status Display
Show timeout in status bar when configured.

## 6. Session State Management
Update persistState() and restoreFromBranch() to handle timeout.

## 7. Comprehensive Tests
Add tests for timeout functionality across all tools.