# @cynosure-mcp/system-notifications

MCP server for sending local desktop notifications on Windows, macOS, and Linux.

## Installation

```bash
npx @cynosure-mcp/system-notifications
```

Or install globally:

```bash
npm install -g @cynosure-mcp/system-notifications
system-notifications
```

## Tools

| Tool                         | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `send_system_notification`   | Send a local desktop notification                     |
| `check_notification_support` | Check whether a notification backend is available     |

## MCP Config

```json
{
  "mcpServers": {
    "system-notifications": {
      "command": "npx",
      "args": ["@cynosure-mcp/system-notifications"]
    }
  }
}
```

## Platform Notes

### Windows

Uses PowerShell and `System.Windows.Forms.NotifyIcon`.

### macOS

Uses AppleScript through `osascript`.

### Linux

Uses `notify-send`. Install `libnotify-bin` or the equivalent package for your distribution if it is missing.

## License

MIT
