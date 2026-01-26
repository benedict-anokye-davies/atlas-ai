# PRD-T2: Browser Automation & App Integrations (Phases 3-4)

## Terminal Assignment: T2

## Phases: 3 (Browser Automation), 4 (App Integrations)

## Estimated Tasks: 47

## Priority: HIGH - Foundation for desktop control

---

## Overview

T2 is responsible for implementing full browser automation via Chrome DevTools Protocol (CDP) for Brave browser, and integrating with key desktop applications (Spotify, VS Code, Discord, File Explorer).

**CRITICAL**: Every tool must ACTUALLY WORK end-to-end. Test each tool manually before marking complete.

---

## File Ownership

```
src/main/agent/tools/browser-cdp.ts       # CDP browser automation (ENHANCE)
src/main/agent/tools/spotify.ts           # Spotify integration (ENHANCE)
src/main/agent/tools/vscode.ts            # VS Code integration (ENHANCE)
src/main/agent/tools/discord.ts           # Discord integration (ENHANCE)
src/main/agent/tools/explorer.ts          # File Explorer (ENHANCE)
src/main/integrations/browser-manager.ts  # NEW: Browser session management
src/main/integrations/spotify-auth.ts     # NEW: Spotify OAuth
src/main/integrations/discord-bot.ts      # NEW: Discord bot client
tests/browser-cdp.test.ts                 # NEW: Browser tests
tests/spotify.test.ts                     # NEW: Spotify tests
tests/discord.test.ts                     # NEW: Discord tests
```

## IPC Channels

- `browser:*` - Browser automation
- `spotify:*` - Spotify control
- `vscode:*` - VS Code integration
- `discord:*` - Discord messaging
- `explorer:*` - File Explorer

---

## Phase 3: Browser Automation (Brave via CDP)

### Dependencies

```bash
npm install puppeteer-core chrome-remote-interface
```

### Task T2-101: Launch Brave with Remote Debugging [HIGH]

**File:** `src/main/integrations/browser-manager.ts`

**Requirements:**

1. Detect Brave installation path on Windows
2. Launch Brave with `--remote-debugging-port=9222`
3. Handle case where Brave is already running (connect to existing)
4. Support headless mode option
5. Handle launch errors gracefully
6. Store browser process reference for cleanup

**Implementation Details:**

```typescript
const BRAVE_PATHS_WINDOWS = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  path.join(os.homedir(), 'AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
];

interface BrowserLaunchOptions {
  headless?: boolean;
  debugPort?: number;
  userDataDir?: string;
  args?: string[];
}

export class BrowserManager {
  private browser: Browser | null = null;
  private debugPort = 9222;

  async launch(options?: BrowserLaunchOptions): Promise<void>;
  async connect(): Promise<void>;
  async isRunning(): Promise<boolean>;
  async getDebugUrl(): Promise<string>;
  async close(): Promise<void>;
}
```

**Test Checklist:**

- [ ] Detects Brave installation
- [ ] Launches Brave with debugging enabled
- [ ] Connects to already-running Brave
- [ ] Handles missing Brave gracefully
- [ ] Closes browser cleanly

---

### Task T2-102: CDP Connection Manager [HIGH]

**File:** `src/main/integrations/browser-manager.ts`

**Requirements:**

1. Connect to Brave via WebSocket (CDP)
2. Auto-reconnect on disconnect
3. Handle connection timeouts
4. Manage multiple pages/tabs
5. Emit events for connection state changes
6. Graceful shutdown

**Implementation Details:**

```typescript
interface CDPConnection {
  client: CDPSession;
  page: Page;
  connected: boolean;
}

class CDPConnectionManager extends EventEmitter {
  private connections: Map<string, CDPConnection> = new Map();

  async connect(port?: number): Promise<void>;
  async disconnect(): Promise<void>;
  async getActivePage(): Promise<Page>;
  async createNewPage(): Promise<Page>;
  isConnected(): boolean;
  on(event: 'connected' | 'disconnected' | 'error', handler: Function): this;
}
```

**Test Checklist:**

- [ ] Connects to Brave CDP endpoint
- [ ] Handles connection loss gracefully
- [ ] Auto-reconnects after disconnect
- [ ] Manages multiple pages
- [ ] Emits correct events

---

### Task T2-103: Navigation Controls [HIGH]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_back` | Go back in history |
| `browser_forward` | Go forward in history |
| `browser_refresh` | Refresh current page |
| `browser_get_url` | Get current URL |

**Requirements:**

1. Navigate to any URL
2. Wait for page load to complete
3. Handle navigation errors (404, timeout, etc.)
4. Support waiting for specific element after navigation
5. Return page title and URL after navigation

**Implementation:**

```typescript
export const browserNavigateTool: AgentTool = {
  name: 'browser_navigate',
  description: 'Navigate browser to a URL. Returns page title and URL when loaded.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
      waitFor: { type: 'string', description: 'Optional CSS selector to wait for' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    },
    required: ['url'],
  },
  execute: async (params) => {
    // Implementation
  },
};
```

**Test Checklist:**

- [ ] Navigate to google.com
- [ ] Navigate to invalid URL (handle error)
- [ ] Back/forward navigation works
- [ ] Refresh reloads page
- [ ] Get URL returns correct value

---

### Task T2-104: Element Interaction [HIGH]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_click` | Click element by selector |
| `browser_click_text` | Click element containing text |
| `browser_click_coordinates` | Click at x,y coordinates |
| `browser_hover` | Hover over element |
| `browser_scroll` | Scroll page or element |

**Requirements:**

1. Click by CSS selector
2. Click by text content (find element containing text)
3. Click at specific coordinates
4. Scroll to element before clicking if needed
5. Handle element not found errors
6. Support double-click and right-click

**Implementation:**

```typescript
export const browserClickTool: AgentTool = {
  name: 'browser_click',
  description: 'Click an element on the page by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of element to click' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
      clickCount: { type: 'number', description: '1 for single, 2 for double click' },
    },
    required: ['selector'],
  },
  execute: async (params) => {
    // Scroll element into view
    // Wait for element to be clickable
    // Perform click
    // Return success/failure
  },
};
```

**Test Checklist:**

- [ ] Click button by selector
- [ ] Click link by text content
- [ ] Click at coordinates
- [ ] Handle missing element
- [ ] Double-click works
- [ ] Right-click works

---

### Task T2-105: Form Input [HIGH]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_type` | Type text into input field |
| `browser_clear` | Clear input field |
| `browser_select` | Select dropdown option |
| `browser_check` | Check/uncheck checkbox |
| `browser_submit` | Submit form |

**Requirements:**

1. Type text character by character (realistic typing)
2. Support modifier keys (Shift, Ctrl)
3. Clear existing text before typing (option)
4. Select dropdown by value, text, or index
5. Toggle checkboxes and radio buttons
6. Submit forms

**Implementation:**

```typescript
export const browserTypeTool: AgentTool = {
  name: 'browser_type',
  description: 'Type text into an input field.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of input field' },
      text: { type: 'string', description: 'Text to type' },
      clearFirst: { type: 'boolean', description: 'Clear field before typing' },
      delay: { type: 'number', description: 'Delay between keystrokes in ms' },
    },
    required: ['selector', 'text'],
  },
  execute: async (params) => {
    // Focus element
    // Optionally clear existing text
    // Type text with delay
    // Return success
  },
};
```

**Test Checklist:**

- [ ] Type in text input
- [ ] Type in textarea
- [ ] Clear and type
- [ ] Select dropdown option
- [ ] Check checkbox
- [ ] Submit form

---

### Task T2-106: Content Extraction [HIGH]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_get_text` | Get text content from element |
| `browser_get_html` | Get HTML of element |
| `browser_get_attribute` | Get element attribute |
| `browser_get_all_text` | Get all text from page |
| `browser_get_links` | Get all links on page |
| `browser_evaluate` | Run JavaScript and return result |

**Requirements:**

1. Extract text from specific element
2. Extract full page text (cleaned)
3. Get element attributes (href, src, etc.)
4. Extract all links with text and URLs
5. Run arbitrary JavaScript for custom extraction
6. Handle iframes

**Implementation:**

```typescript
export const browserGetTextTool: AgentTool = {
  name: 'browser_get_text',
  description: 'Get text content from an element.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector (omit for full page)' },
      includeHidden: { type: 'boolean', description: 'Include hidden elements' },
    },
    required: [],
  },
  execute: async (params) => {
    // Get element or page
    // Extract text content
    // Clean and return
  },
};
```

**Test Checklist:**

- [ ] Get text from element
- [ ] Get full page text
- [ ] Get link href
- [ ] Get image src
- [ ] Run custom JS
- [ ] Extract all links

---

### Task T2-107: Tab Management [MEDIUM]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_new_tab` | Open new tab |
| `browser_close_tab` | Close tab |
| `browser_switch_tab` | Switch to tab |
| `browser_list_tabs` | List all tabs |
| `browser_get_active_tab` | Get active tab info |

**Requirements:**

1. Open new tab (optionally with URL)
2. Close current or specific tab
3. Switch between tabs
4. List all open tabs with title/URL
5. Handle multiple windows

**Test Checklist:**

- [ ] Open new tab
- [ ] Navigate in new tab
- [ ] Switch between tabs
- [ ] Close tab
- [ ] List all tabs

---

### Task T2-108: Authentication Handling [MEDIUM]

**File:** `src/main/integrations/browser-manager.ts`

**Requirements:**

1. Save cookies/session to disk
2. Load cookies on browser start
3. Handle login forms automatically
4. Support credential storage (secure)
5. Detect logged-out state

**Implementation:**

```typescript
class AuthenticationManager {
  async saveCookies(domain: string): Promise<void>;
  async loadCookies(domain: string): Promise<void>;
  async isLoggedIn(domain: string, checkSelector: string): Promise<boolean>;
  async login(
    domain: string,
    credentials: Credentials,
    selectors: LoginSelectors
  ): Promise<boolean>;
  async clearSession(domain: string): Promise<void>;
}

interface LoginSelectors {
  usernameField: string;
  passwordField: string;
  submitButton: string;
  successIndicator: string;
}
```

**Test Checklist:**

- [ ] Save cookies for domain
- [ ] Load cookies on restart
- [ ] Auto-login to test site
- [ ] Detect logged-out state
- [ ] Clear session works

---

### Task T2-109: Element Screenshots [LOW]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_screenshot` | Screenshot full page or element |
| `browser_screenshot_element` | Screenshot specific element |

**Requirements:**

1. Full page screenshot
2. Viewport screenshot
3. Element-specific screenshot
4. Return as base64 or save to file
5. Support quality/format options

**Test Checklist:**

- [ ] Full page screenshot
- [ ] Element screenshot
- [ ] Save to file
- [ ] Return base64

---

### Task T2-110: Wait Strategies [HIGH]

**File:** `src/main/agent/tools/browser-cdp.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `browser_wait_element` | Wait for element to appear |
| `browser_wait_navigation` | Wait for navigation complete |
| `browser_wait_network` | Wait for network idle |
| `browser_wait_timeout` | Simple timeout wait |

**Requirements:**

1. Wait for element to be visible
2. Wait for element to be clickable
3. Wait for navigation to complete
4. Wait for network requests to finish
5. Configurable timeouts

**Test Checklist:**

- [ ] Wait for element appears
- [ ] Wait for navigation
- [ ] Wait for network idle
- [ ] Timeout triggers correctly

---

## Phase 4: App Integrations

### Task T2-201: Spotify OAuth Setup [HIGH]

**File:** `src/main/integrations/spotify-auth.ts`

**Requirements:**

1. Register Spotify Developer app (document in README)
2. Implement OAuth 2.0 PKCE flow
3. Store refresh token in keychain
4. Auto-refresh access token
5. Handle token expiration

**Implementation:**

```typescript
export class SpotifyAuth {
  private clientId: string;
  private redirectUri = 'http://localhost:8888/callback';

  async authorize(): Promise<void>; // Opens browser
  async getAccessToken(): Promise<string>;
  async refreshToken(): Promise<void>;
  async isAuthorized(): Promise<boolean>;
  async logout(): Promise<void>;
}
```

**Test Checklist:**

- [ ] OAuth flow opens browser
- [ ] Callback receives code
- [ ] Tokens stored securely
- [ ] Token refresh works
- [ ] Logout clears tokens

---

### Task T2-202: Spotify Playback Control [HIGH]

**File:** `src/main/agent/tools/spotify.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `spotify_play` | Play/resume playback |
| `spotify_pause` | Pause playback |
| `spotify_next` | Skip to next track |
| `spotify_previous` | Go to previous track |
| `spotify_seek` | Seek to position |
| `spotify_set_volume` | Set volume level |
| `spotify_get_playing` | Get currently playing |
| `spotify_get_devices` | List available devices |
| `spotify_transfer` | Transfer playback to device |

**Requirements:**

1. Control playback (play, pause, next, prev)
2. Get currently playing track info
3. Set volume (0-100)
4. Seek to position in track
5. List and switch between devices
6. Handle no active device

**Implementation:**

```typescript
export const spotifyPlayTool: AgentTool = {
  name: 'spotify_play',
  description: 'Play or resume Spotify playback. Can play specific track, album, or playlist.',
  parameters: {
    type: 'object',
    properties: {
      uri: { type: 'string', description: 'Spotify URI (track, album, playlist)' },
      deviceId: { type: 'string', description: 'Device to play on (optional)' },
    },
    required: [],
  },
  execute: async (params) => {
    // Check if authorized
    // Get access token
    // Call Spotify API
    // Return current track info
  },
};
```

**Test Checklist:**

- [ ] Play/pause works
- [ ] Next/previous works
- [ ] Volume control works
- [ ] Get currently playing
- [ ] Device switching works

---

### Task T2-203: Spotify Search & Queue [MEDIUM]

**File:** `src/main/agent/tools/spotify.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `spotify_search` | Search tracks/albums/artists |
| `spotify_add_queue` | Add track to queue |
| `spotify_get_queue` | Get current queue |
| `spotify_get_playlists` | Get user playlists |
| `spotify_play_playlist` | Play specific playlist |
| `spotify_get_recommendations` | Get track recommendations |

**Test Checklist:**

- [ ] Search returns results
- [ ] Add to queue works
- [ ] Get playlists works
- [ ] Play playlist works

---

### Task T2-204: VS Code CLI Integration [MEDIUM]

**File:** `src/main/agent/tools/vscode.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `vscode_open_file` | Open file at line |
| `vscode_open_folder` | Open folder/workspace |
| `vscode_diff` | Open diff view |
| `vscode_install_extension` | Install extension |
| `vscode_run_command` | Run VS Code command |
| `vscode_get_extensions` | List installed extensions |

**Requirements:**

1. Detect VS Code installation
2. Use `code` CLI for operations
3. Open files at specific line/column
4. Open folders and workspaces
5. Install/uninstall extensions
6. Run arbitrary VS Code commands

**Implementation:**

```typescript
export const vscodeOpenFileTool: AgentTool = {
  name: 'vscode_open_file',
  description: 'Open a file in VS Code, optionally at a specific line and column.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to open' },
      line: { type: 'number', description: 'Line number (optional)' },
      column: { type: 'number', description: 'Column number (optional)' },
      reuse: { type: 'boolean', description: 'Reuse existing window' },
    },
    required: ['path'],
  },
  execute: async (params) => {
    // Build command: code --goto file:line:column
    // Execute via child_process
    // Return success
  },
};
```

**Test Checklist:**

- [ ] Open file works
- [ ] Open at line works
- [ ] Open folder works
- [ ] Diff view works
- [ ] Install extension works

---

### Task T2-205: VS Code Terminal Integration [MEDIUM]

**File:** `src/main/agent/tools/vscode.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `vscode_new_terminal` | Open new integrated terminal |
| `vscode_run_task` | Run VS Code task |
| `vscode_get_tasks` | List available tasks |

**Test Checklist:**

- [ ] New terminal opens
- [ ] Run task works
- [ ] List tasks works

---

### Task T2-206: Discord Bot Setup [MEDIUM]

**File:** `src/main/integrations/discord-bot.ts`

**Requirements:**

1. Connect using user-provided bot token
2. Store token in keychain
3. Handle connection/reconnection
4. List servers and channels
5. Handle rate limiting

**Implementation:**

```typescript
export class DiscordBot extends EventEmitter {
  private client: Client;

  async connect(token: string): Promise<void>;
  async disconnect(): Promise<void>;
  isConnected(): boolean;
  async getServers(): Promise<Guild[]>;
  async getChannels(serverId: string): Promise<Channel[]>;
  on(event: 'message' | 'connected' | 'disconnected', handler: Function): this;
}
```

**Test Checklist:**

- [ ] Connects with token
- [ ] Lists servers
- [ ] Lists channels
- [ ] Handles disconnect

---

### Task T2-207: Discord Messaging [MEDIUM]

**File:** `src/main/agent/tools/discord.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `discord_send_message` | Send message to channel |
| `discord_read_messages` | Read recent messages |
| `discord_get_channels` | List channels |
| `discord_get_servers` | List servers |
| `discord_react` | Add reaction |
| `discord_get_mentions` | Get @mentions |

**Test Checklist:**

- [ ] Send message works
- [ ] Read messages works
- [ ] List channels works
- [ ] Add reaction works

---

### Task T2-208: File Explorer Integration [LOW]

**File:** `src/main/agent/tools/explorer.ts`

**Tools to Implement:**
| Tool | Description |
|------|-------------|
| `explorer_open` | Open folder in Explorer |
| `explorer_reveal` | Reveal file in Explorer |
| `explorer_quick_access` | Get Quick Access items |
| `explorer_recent` | Get recent files |

**Implementation:**

```bash
# Open folder
explorer.exe "C:\path\to\folder"

# Reveal file (select in Explorer)
explorer.exe /select,"C:\path\to\file.txt"
```

**Test Checklist:**

- [ ] Open folder works
- [ ] Reveal file works
- [ ] Quick Access items returned
- [ ] Recent files returned

---

## Integration Tests

### Task T2-301: Browser E2E Test Suite [HIGH]

**File:** `tests/browser-cdp.test.ts`

Create comprehensive tests:

```typescript
describe('Browser CDP Tools', () => {
  describe('Navigation', () => {
    it('should navigate to URL');
    it('should handle navigation errors');
    it('should go back and forward');
  });

  describe('Interaction', () => {
    it('should click element by selector');
    it('should type in input field');
    it('should submit form');
  });

  describe('Extraction', () => {
    it('should get page text');
    it('should get element attributes');
    it('should run custom JS');
  });

  describe('Tabs', () => {
    it('should manage multiple tabs');
  });
});
```

---

### Task T2-302: Spotify E2E Test Suite [MEDIUM]

**File:** `tests/spotify.test.ts`

---

### Task T2-303: Discord E2E Test Suite [MEDIUM]

**File:** `tests/discord.test.ts`

---

## Task Summary

| ID     | Task                         | Phase | Priority | Est. Hours |
| ------ | ---------------------------- | ----- | -------- | ---------- |
| T2-101 | Launch Brave with debugging  | 3     | HIGH     | 4          |
| T2-102 | CDP connection manager       | 3     | HIGH     | 4          |
| T2-103 | Navigation controls          | 3     | HIGH     | 3          |
| T2-104 | Element interaction          | 3     | HIGH     | 4          |
| T2-105 | Form input                   | 3     | HIGH     | 3          |
| T2-106 | Content extraction           | 3     | HIGH     | 3          |
| T2-107 | Tab management               | 3     | MEDIUM   | 2          |
| T2-108 | Authentication handling      | 3     | MEDIUM   | 4          |
| T2-109 | Element screenshots          | 3     | LOW      | 2          |
| T2-110 | Wait strategies              | 3     | HIGH     | 2          |
| T2-201 | Spotify OAuth setup          | 4     | HIGH     | 4          |
| T2-202 | Spotify playback control     | 4     | HIGH     | 4          |
| T2-203 | Spotify search & queue       | 4     | MEDIUM   | 3          |
| T2-204 | VS Code CLI integration      | 4     | MEDIUM   | 3          |
| T2-205 | VS Code terminal integration | 4     | MEDIUM   | 2          |
| T2-206 | Discord bot setup            | 4     | MEDIUM   | 4          |
| T2-207 | Discord messaging            | 4     | MEDIUM   | 3          |
| T2-208 | File Explorer integration    | 4     | LOW      | 2          |
| T2-301 | Browser E2E test suite       | 3     | HIGH     | 4          |
| T2-302 | Spotify E2E test suite       | 4     | MEDIUM   | 2          |
| T2-303 | Discord E2E test suite       | 4     | MEDIUM   | 2          |

**Total Estimated Hours: 64**

---

## Quality Gates

Before marking ANY task DONE:

1. [ ] `npm run typecheck` passes
2. [ ] `npm run lint` passes
3. [ ] Tool works end-to-end (manual test)
4. [ ] Tool registered in `src/main/agent/tools/index.ts`
5. [ ] IPC handlers added if needed
6. [ ] Unit tests written and passing
7. [ ] Error handling is robust

---

## Execution Order

1. **First**: T2-101, T2-102 (Browser foundation)
2. **Then**: T2-103, T2-104, T2-105, T2-106, T2-110 (Core browser tools)
3. **Then**: T2-201, T2-202 (Spotify - most useful app)
4. **Then**: T2-107, T2-108 (Advanced browser)
5. **Then**: T2-204, T2-205 (VS Code)
6. **Then**: T2-206, T2-207 (Discord)
7. **Finally**: T2-109, T2-208, T2-301-303 (Polish)

---

## Notes

- Brave uses same CDP as Chrome - puppeteer-core works
- Spotify requires user to have Premium for some features
- Discord bot token obtained from Discord Developer Portal
- VS Code `code` CLI must be in PATH
- All API keys/tokens stored in OS keychain via keytar
