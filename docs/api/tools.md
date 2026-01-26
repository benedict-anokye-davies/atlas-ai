# Atlas Agent Tools Reference

**Version:** 1.0.0
**Last Updated:** 2026-01-15

This document provides detailed documentation for all agent tools available in Atlas Desktop. These tools enable the LLM to perform actions on behalf of the user.

## Table of Contents

- [Overview](#overview)
- [Tool Interface](#tool-interface)
- [Filesystem Tools](#filesystem-tools)
- [Terminal Tools](#terminal-tools)
- [Browser Tools](#browser-tools)
- [Screenshot Tools](#screenshot-tools)
- [Clipboard Tools](#clipboard-tools)
- [Search Tools](#search-tools)
- [Git Tools](#git-tools)
- [System Tools](#system-tools)
- [Tool Registry API](#tool-registry-api)
- [Security](#security)

## Overview

Agent tools are executable capabilities exposed to the LLM. When the LLM determines a tool is needed, it generates a tool call with appropriate parameters, and Atlas executes it.

### Tool Categories Summary

| Category | Count | Module |
|----------|-------|--------|
| Filesystem | 9 | `src/main/agent/tools/filesystem.ts` |
| Terminal | 5 | `src/main/agent/tools/terminal.ts` |
| Browser | 6 | `src/main/agent/tools/browser.ts` |
| Screenshot | 3 | `src/main/agent/tools/screenshot.ts` |
| Clipboard | 6 | `src/main/agent/tools/clipboard.ts` |
| Search | 2 | `src/main/agent/tools/search.ts` |
| Git | 12 | `src/main/agent/tools/git.ts` |
| System | 10 | `src/main/agent/tools/system-commands.ts` |
| **Total** | **53** | |

## Tool Interface

All tools implement the `AgentTool` interface:

```typescript
interface AgentTool {
  /** Unique tool identifier */
  name: string;
  /** Human-readable description for LLM */
  description: string;
  /** JSON schema for parameters */
  parameters: Record<string, unknown>;
  /** Execution function */
  execute: (params: Record<string, unknown>) => Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

---

## Filesystem Tools

File system operations with built-in security validation.

### read_file

Read the contents of a file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | Yes | - | Absolute or relative path to file |
| `encoding` | `string` | No | `utf-8` | File encoding |
| `maxLines` | `number` | No | All | Maximum lines to read |

**Response:**
```typescript
interface FileReadResult {
  path: string;
  content: string;
  encoding: string;
  size: number;
  lines: number;
  truncated?: boolean;
}
```

**Limits:**
- Max file size: 10MB
- Files larger than 10MB return an error

**Example:**
```json
{
  "name": "read_file",
  "parameters": {
    "path": "./src/index.ts",
    "maxLines": 100
  }
}
```

---

### write_file

Write content to a file (creates or overwrites).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | Yes | - | File path to write |
| `content` | `string` | Yes | - | Content to write |
| `encoding` | `string` | No | `utf-8` | File encoding |
| `createDirectories` | `boolean` | No | `true` | Create parent directories |

**Response:**
```typescript
interface FileWriteResult {
  path: string;
  bytesWritten: number;
  created: boolean;
}
```

---

### append_file

Append content to end of file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | Yes | - | File path |
| `content` | `string` | Yes | - | Content to append |
| `encoding` | `string` | No | `utf-8` | File encoding |

---

### delete_file

Delete a file (not directories).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | File path to delete |

**Note:** Will refuse to delete directories. Use with caution.

---

### list_directory

List files and directories in a path.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | No | `.` | Directory path |
| `recursive` | `boolean` | No | `false` | Include subdirectories |
| `maxDepth` | `number` | No | `3` | Maximum recursion depth |

**Response:**
```typescript
interface DirectoryListResult {
  path: string;
  entries: FileInfo[];
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
}

interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  created: string;
  extension?: string;
}
```

**Limits:**
- Max entries: 1000

---

### search_files

Search for files matching a pattern.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | `string` | Yes | - | Glob pattern (e.g., `*.ts`, `**/*.json`) |
| `path` | `string` | No | `.` | Directory to search |
| `content` | `string` | No | - | Search within file contents |
| `maxResults` | `number` | No | `50` | Maximum results (max 100) |

**Response:**
```typescript
interface FileSearchResult {
  files: FileInfo[];
  totalMatches: number;
  searchPath: string;
  pattern: string;
}
```

---

### copy_file

Copy a file to new location.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | `string` | Yes | - | Source file path |
| `destination` | `string` | Yes | - | Destination path |
| `overwrite` | `boolean` | No | `false` | Overwrite if exists |

---

### move_file

Move or rename a file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | `string` | Yes | - | Source file path |
| `destination` | `string` | Yes | - | Destination path |
| `overwrite` | `boolean` | No | `false` | Overwrite if exists |

---

### create_directory

Create a new directory.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | Yes | - | Directory path |
| `recursive` | `boolean` | No | `true` | Create parent directories |

---

## Terminal Tools

Shell command execution with security controls.

### execute_command

Execute a shell command.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | `string` | Yes | - | Command to execute |
| `cwd` | `string` | No | Current dir | Working directory |
| `timeout` | `number` | No | `30000` | Timeout in ms (max 300000) |
| `env` | `object` | No | - | Additional environment variables |

**Response:**
```typescript
interface TerminalResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  duration: number;
  truncated?: boolean;
  timedOut?: boolean;
}
```

**Limits:**
- Max output: 1MB
- Max timeout: 5 minutes

**Blocked Commands:**
- `rm -rf /`, `rm -rf ~`
- `format`, `:(){:|:&};:`
- `curl | sh`, `wget | bash`
- `cat /etc/shadow`
- And more (see `BLOCKED_COMMANDS` in types)

---

### npm_command

Run npm commands.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `subcommand` | `string` | Yes | - | npm subcommand (e.g., `install`, `run test`) |
| `cwd` | `string` | No | Current dir | Working directory |
| `timeout` | `number` | No | `120000` | Timeout in ms |

**Example:**
```json
{
  "name": "npm_command",
  "parameters": {
    "subcommand": "run build"
  }
}
```

---

### git_command

Run git commands (convenience wrapper).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subcommand` | `string` | Yes | git subcommand |
| `cwd` | `string` | No | Repository directory |

**Blocked:**
- `push --force`
- `reset --hard`
- `clean -f`

---

### get_working_directory

Get current working directory.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

### which_command

Check if a command exists.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | `string` | Yes | Command name to check |

---

## Browser Tools

Playwright-based web automation.

**Note:** Requires Playwright to be installed: `npm install playwright && npx playwright install chromium`

### browser_navigate

Navigate to a URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | Yes | - | URL to navigate to (http/https only) |
| `waitFor` | `string` | No | `domcontentloaded` | Wait condition: `load`, `domcontentloaded`, `networkidle` |
| `timeout` | `number` | No | `30000` | Navigation timeout in ms |

**Blocked URLs:**
- `file://`, `javascript://`, `data://`
- `localhost`, `127.0.0.1`
- Private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)

---

### browser_get_content

Get text content from page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | No | `body` | CSS selector |
| `maxLength` | `number` | No | `10000` | Max content length |

---

### browser_click

Click an element.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | Yes | - | CSS selector |
| `timeout` | `number` | No | `5000` | Element wait timeout |

---

### browser_type

Type text into an input.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | Yes | - | CSS selector |
| `text` | `string` | Yes | - | Text to type |
| `clear` | `boolean` | No | `true` | Clear field first |
| `delay` | `number` | No | `50` | Keystroke delay in ms |

---

### browser_screenshot

Take browser screenshot.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | No | viewport | Element to capture |
| `fullPage` | `boolean` | No | `false` | Capture full page |

**Response includes:** Base64 encoded PNG

---

### browser_close

Close browser and cleanup.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

## Screenshot Tools

Desktop and window capture using Electron's desktopCapturer.

### capture_screen

Capture entire screen.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `displayIndex` | `number` | No | `0` | Display index |
| `format` | `string` | No | `png` | `png` or `jpeg` |
| `savePath` | `string` | No | - | Save path (returns base64 if omitted) |

**Response:**
```typescript
interface ScreenshotResult {
  path?: string;
  base64?: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  size: number;
  timestamp: string;
  source: string;
}
```

---

### capture_window

Capture specific window.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `windowName` | `string` | Yes | - | Window name (partial match) |
| `format` | `string` | No | `png` | `png` or `jpeg` |
| `savePath` | `string` | No | - | Save path |

---

### list_capture_sources

List available screens and windows.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

## Clipboard Tools

System clipboard operations.

### clipboard_read_text

Read text from clipboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | `string` | No | `text` | `text` or `html` |

**Security:** Scans for sensitive patterns (credit cards, SSN, private keys) and warns.

**Limits:** Max 1MB

---

### clipboard_write_text

Write text to clipboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `string` | Yes | - | Text to write |
| `type` | `string` | No | `text` | `text` or `html` |

---

### clipboard_read_image

Read image from clipboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | `string` | No | `png` | `png` or `jpeg` |

**Response includes:** Base64 encoded image

---

### clipboard_write_image

Write image to clipboard.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base64` | `string` | No* | Base64 image data |
| `filePath` | `string` | No* | Image file path |

*One of `base64` or `filePath` is required.

---

### clipboard_clear

Clear the clipboard.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

### clipboard_formats

Get available clipboard formats.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

**Response:**
```typescript
{
  formats: string[];
  hasText: boolean;
  hasHTML: boolean;
  hasImage: boolean;
}
```

---

## Search Tools

Web search and URL fetching.

### web_search

Search the web using DuckDuckGo.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | - | Search query |
| `maxResults` | `number` | No | `5` | Max results (max 10) |
| `region` | `string` | No | `us-en` | Region code |

**Response:**
```typescript
interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
  searchEngine: string;
  timestamp: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}
```

---

### fetch_url

Fetch and extract content from URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | Yes | - | URL to fetch |
| `maxLength` | `number` | No | `10000` | Max content length |
| `extractText` | `boolean` | No | `true` | Extract plain text from HTML |

**Allowed protocols:** `http://`, `https://` only

---

## Git Tools

Comprehensive git operations.

### git_status

Get repository status.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | No | Current dir | Repository path |

**Response:**
```typescript
interface GitStatusResult {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  modified: GitFileStatus[];
  staged: GitFileStatus[];
  untracked: GitFileStatus[];
  files: GitFileStatus[];
  hasConflicts: boolean;
  repoRoot: string;
}

interface GitFileStatus {
  path: string;
  status: string;  // M, A, D, ??, UU, etc.
  staged: boolean;
  description: string;
}
```

---

### git_add

Stage files for commit.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `files` | `string[]` | No | `["."]` | Files to stage |
| `path` | `string` | No | Current dir | Repository path |

---

### git_commit

Create a commit.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Commit message |
| `path` | `string` | No | Repository path |

**Response:**
```typescript
interface GitCommitResult {
  sha: string;
  message: string;
  author: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}
```

---

### git_push

Push commits to remote.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `remote` | `string` | No | `origin` | Remote name |
| `branch` | `string` | No | Current | Branch name |
| `setUpstream` | `boolean` | No | `false` | Set tracking branch |
| `path` | `string` | No | Current dir | Repository path |

---

### git_pull

Pull changes from remote.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `remote` | `string` | No | `origin` | Remote name |
| `branch` | `string` | No | - | Branch (uses tracking) |
| `path` | `string` | No | Current dir | Repository path |

---

### git_branch_list

List branches.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `includeRemote` | `boolean` | No | `true` | Include remote branches |
| `path` | `string` | No | Current dir | Repository path |

---

### git_branch_create

Create new branch.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Branch name |
| `startPoint` | `string` | No | `HEAD` | Starting commit/branch |
| `checkout` | `boolean` | No | `true` | Switch to new branch |
| `path` | `string` | No | Current dir | Repository path |

**Validation:** Branch names cannot contain `~`, `^`, `:`, spaces, or backslashes.

---

### git_branch_switch

Switch branches.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Branch to switch to |
| `force` | `boolean` | No | `false` | Discard uncommitted changes |
| `path` | `string` | No | Current dir | Repository path |

**Warning:** Will refuse if uncommitted changes exist (unless `force: true`).

---

### git_branch_delete

Delete a branch.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Branch to delete |
| `force` | `boolean` | No | `false` | Delete even if not merged |
| `remote` | `boolean` | No | `false` | Also delete remote branch |
| `path` | `string` | No | Current dir | Repository path |

**Protected branches:** `main`, `master`, `develop`, `production` require `force: true`.

---

### git_stash

Stash uncommitted changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | `string` | No | - | Stash description |
| `includeUntracked` | `boolean` | No | `false` | Include untracked files |
| `path` | `string` | No | Current dir | Repository path |

---

### git_stash_apply

Apply stashed changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `index` | `number` | No | `0` | Stash index |
| `pop` | `boolean` | No | `true` | Remove stash after apply |
| `path` | `string` | No | Current dir | Repository path |

---

### git_log

Get commit history.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `count` | `number` | No | `10` | Number of commits |
| `oneline` | `boolean` | No | `false` | Compact format |
| `branch` | `string` | No | Current | Branch to show |
| `path` | `string` | No | Current dir | Repository path |

---

### git_diff

Show changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `staged` | `boolean` | No | `false` | Show staged changes |
| `commit` | `string` | No | - | Compare with commit |
| `file` | `string` | No | - | Specific file |
| `stat` | `boolean` | No | `false` | Summary only |
| `path` | `string` | No | Current dir | Repository path |

---

## System Tools

Operating system control capabilities.

### system_screenshot

Take screenshot and save to `~/Pictures/Atlas/`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `displayIndex` | `number` | No | `0` | Display to capture |
| `format` | `string` | No | `png` | `png` or `jpeg` |
| `filename` | `string` | No | Auto | Custom filename |

---

### system_lock

Lock the computer screen.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

**Platform support:** Windows, macOS, Linux (systemd, GNOME, KDE)

---

### system_open_app

Open an application.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appName` | `string` | Yes | App name or alias |
| `args` | `string` | No | Command arguments |

**Built-in aliases:**
| Alias | Windows | macOS | Linux |
|-------|---------|-------|-------|
| `browser` | Chrome/Edge/Firefox | Chrome/Safari/Firefox | Chrome/Firefox |
| `chrome` | Chrome | Google Chrome | google-chrome |
| `vscode`/`code` | code | Visual Studio Code | code |
| `terminal` | cmd | Terminal | gnome-terminal |
| `calculator` | calc | Calculator | gnome-calculator |
| `explorer`/`finder` | explorer | Finder | nautilus |
| `settings` | ms-settings: | System Preferences | gnome-control-center |
| `spotify` | spotify: | Spotify | spotify |
| `slack` | slack: | Slack | slack |
| `discord` | discord: | Discord | discord |

---

### system_set_timer

Set a countdown timer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `duration` | `string` | Yes | Duration (e.g., "5 minutes", "1h 30m") |
| `name` | `string` | No | Timer name |

**Duration formats:**
- `"5 minutes"`, `"30 seconds"`, `"1 hour"`
- `"1h 30m"`, `"45s"`
- `"5"` (interpreted as minutes)

**Limits:** Max 24 hours

---

### system_cancel_timer

Cancel an active timer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | No* | Timer ID |
| `name` | `string` | No* | Timer name (partial match) |

*One of `id` or `name` is required.

---

### system_list_timers

List all active timers.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

### system_set_volume

Set system volume.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | `number` | No* | Volume 0-100 |
| `mute` | `boolean` | No* | Mute/unmute |

*One of `level` or `mute` is required.

---

### system_get_volume

Get current volume level.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

### system_set_brightness

Set display brightness.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | `number` | Yes | Brightness 0-100 |

**Note:** May not work on external monitors.

---

### system_get_brightness

Get current brightness.

| Parameter | Type | Required |
|-----------|------|----------|
| (none) | - | - |

---

## Tool Registry API

Access tools programmatically.

```typescript
import {
  getAllTools,
  getToolByName,
  getToolsByCategory,
  getToolNames,
  getCategoryNames,
  hasToolByName,
  toolCategories
} from './agent/tools';

// Get all tools
const tools = getAllTools();
// => AgentTool[]

// Get tool by name
const readFile = getToolByName('read_file');
// => AgentTool | undefined

// Get tools by category
const fsTools = getToolsByCategory('filesystem');
// => AgentTool[]

// Check if tool exists
const exists = hasToolByName('git_status');
// => boolean

// Get all tool names
const names = getToolNames();
// => ['read_file', 'write_file', ...]

// Get category names
const categories = getCategoryNames();
// => ['filesystem', 'terminal', 'browser', ...]

// Direct category access
const gitTools = toolCategories.git;
```

### Executing Tools

```typescript
const tool = getToolByName('read_file');
if (tool) {
  const result = await tool.execute({
    path: './package.json'
  });

  if (result.success) {
    console.log('Content:', result.data.content);
  } else {
    console.error('Error:', result.error);
  }
}
```

---

## Security

### Filesystem Security

**Blocked paths:**
- `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`
- `C:\Windows\System32`, `C:\Windows\SysWOW64`
- `.ssh/id_rsa`, `.gnupg`, `.aws/credentials`
- `.env`, `*.pem`, `*.key`

**Path traversal:** Detected and flagged as medium risk.

**System directories:** `/etc`, `/var`, `/usr`, `C:\Windows` require confirmation.

### Terminal Security

**Blocked commands:**
- `rm -rf /`, `rm -rf ~`
- `del /F /S /Q C:\`
- `format`, `mkfs`
- `curl | sh`, `wget | bash`
- `cat /etc/shadow`
- Registry modification (`reg delete`, `reg add HKLM`)

**Safe commands (allowlisted):**
`ls`, `dir`, `pwd`, `cd`, `echo`, `cat`, `head`, `tail`, `grep`, `find`, `which`, `where`, `node`, `npm`, `npx`, `yarn`, `pnpm`, `git`, `python`, `pip`, `code`

**High-risk patterns (require confirmation):**
- `rm -rf`, `sudo`, `chmod`, `chown`
- `npm publish`, `git push --force`, `git reset --hard`

### Browser Security

**Blocked URLs:**
- `file://`, `javascript://`, `data://`, `vbscript://`
- Localhost and private IPs

### Clipboard Security

**Sensitive pattern detection:**
- Credit card numbers (`\b\d{16}\b`)
- SSN (`\b\d{3}-\d{2}-\d{4}\b`)
- Private keys (`-----BEGIN .* PRIVATE KEY-----`)

---

## Related Documentation

- [Main API Reference](../API.md)
- [IPC Channels Reference](./ipc-channels.md)
