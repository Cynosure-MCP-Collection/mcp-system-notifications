#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execFile } from 'node:child_process';
import { platform as osPlatform } from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const PLATFORM = osPlatform();

interface NotificationOptions {
    title: string;
    message: string;
    subtitle?: string;
    appName: string;
    sound?: string;
    urgency: 'low' | 'normal' | 'critical';
    timeoutMs: number;
}

function log(msg: string): void {
    process.stderr.write(`[system-notifications-mcp ${new Date().toISOString()}] ${msg}\n`);
}

function appleScriptString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64');
}

async function commandExists(command: string): Promise<boolean> {
    try {
        if (PLATFORM === 'win32') {
            await execFileAsync('where', [command], { timeout: 3000 });
        } else {
            await execFileAsync('sh', ['-c', `command -v ${command}`], { timeout: 3000 });
        }
        return true;
    } catch {
        return false;
    }
}

async function sendMacNotification(opts: NotificationOptions): Promise<string> {
    let script = `display notification ${appleScriptString(opts.message)} with title ${appleScriptString(opts.title)}`;
    if (opts.subtitle) script += ` subtitle ${appleScriptString(opts.subtitle)}`;
    if (opts.sound) script += ` sound name ${appleScriptString(opts.sound)}`;

    await execFileAsync('osascript', ['-e', script], { timeout: opts.timeoutMs });
    return 'Sent via osascript.';
}

async function sendLinuxNotification(opts: NotificationOptions): Promise<string> {
    const args = [
        '-a', opts.appName,
        '-u', opts.urgency,
        '-t', String(opts.timeoutMs),
        opts.title,
        opts.subtitle ? `${opts.subtitle}\n${opts.message}` : opts.message,
    ];
    await execFileAsync('notify-send', args, { timeout: opts.timeoutMs + 3000 });
    return 'Sent via notify-send.';
}

async function sendWindowsNotification(opts: NotificationOptions): Promise<string> {
    const title = toBase64(opts.title);
    const body = toBase64(opts.subtitle ? `${opts.subtitle}\n${opts.message}` : opts.message);
    const appName = toBase64(opts.appName);
    const timeout = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
    const icon = opts.urgency === 'critical' ? 'Error' : opts.urgency === 'low' ? 'Info' : 'None';

    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$enc = [System.Text.Encoding]::UTF8
$title = $enc.GetString([Convert]::FromBase64String('${title}'))
$body = $enc.GetString([Convert]::FromBase64String('${body}'))
$appName = $enc.GetString([Convert]::FromBase64String('${appName}'))
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${icon}
$notify.BalloonTipTitle = $title
$notify.BalloonTipText = $body
$notify.Text = $appName.Substring(0, [Math]::Min(63, $appName.Length))
$notify.Visible = $true
$notify.ShowBalloonTip(${timeout * 1000})
Start-Sleep -Seconds ${timeout}
$notify.Dispose()
`;

    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: opts.timeoutMs + 5000 });
    return 'Sent via PowerShell NotifyIcon.';
}

async function sendNotification(opts: NotificationOptions): Promise<string> {
    if (PLATFORM === 'darwin') return sendMacNotification(opts);
    if (PLATFORM === 'win32') return sendWindowsNotification(opts);
    return sendLinuxNotification(opts);
}

async function supportStatus(): Promise<string> {
    if (PLATFORM === 'darwin') {
        return await commandExists('osascript')
            ? 'Supported: osascript is available.'
            : 'Not supported: osascript was not found.';
    }
    if (PLATFORM === 'win32') {
        return await commandExists('powershell')
            ? 'Supported: PowerShell is available.'
            : 'Not supported: PowerShell was not found.';
    }
    return await commandExists('notify-send')
        ? 'Supported: notify-send is available.'
        : 'Not supported: notify-send was not found. Install libnotify-bin or the equivalent package for this Linux distribution.';
}

const server = new McpServer({
    name: 'System Notifications',
    version: '1.0.0',
    title: 'System Notifications',
    description: 'Send local desktop notifications through the host operating system.',
    icons: [{ src: 'https://raw.githubusercontent.com/andreasjhagen/Cynosure-MCPs/main/mcp-system-notifications/icon.png', mimeType: 'image/png' }],
});

server.registerTool(
    'send_system_notification',
    {
        description: 'Send a local desktop notification on the host system.',
        inputSchema: {
            title: z.string().min(1).max(128).describe('Notification title.'),
            message: z.string().min(1).max(1024).describe('Notification body text.'),
            subtitle: z.string().max(256).optional().describe('Optional subtitle. Supported directly on macOS; folded into the message on Windows and Linux.'),
            app_name: z.string().min(1).max(64).default('Cynosure MCP').describe('Application name shown by supported notification backends.'),
            sound: z.string().optional().describe('macOS notification sound name, such as "Glass" or "Ping". Ignored on Windows and Linux.'),
            urgency: z.enum(['low', 'normal', 'critical']).default('normal').describe('Linux urgency level. On Windows, critical maps to an error-style notification.'),
            timeout_ms: z.number().int().min(1000).max(60000).default(5000).describe('Requested display duration in milliseconds. Some platforms may ignore it.'),
        },
    },
    async ({ title, message, subtitle, app_name, sound, urgency, timeout_ms }) => {
        try {
            const backend = await sendNotification({
                title,
                message,
                subtitle,
                appName: app_name,
                sound,
                urgency,
                timeoutMs: timeout_ms,
            });
            return {
                content: [{ type: 'text', text: `Notification sent. ${backend}` }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to send notification: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    },
);

server.registerTool(
    'check_notification_support',
    {
        description: 'Check whether the current system has a notification backend available for this MCP.',
        inputSchema: {},
    },
    async () => {
        try {
            return {
                content: [{ type: 'text', text: await supportStatus() }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to check notification support: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    },
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('System Notifications MCP server running on stdio');
}

main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
