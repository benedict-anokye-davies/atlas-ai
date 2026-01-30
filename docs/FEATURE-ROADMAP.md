# Atlas Feature Roadmap

> Inspired by [Clawdbot](https://github.com/clawdbot/clawdbot) — the personal AI assistant platform.

This document outlines the planned features for Atlas Desktop, organized by implementation phase.

**Last Updated**: January 2025

---

## Reference Links

- **Clawdbot Docs**: https://docs.clawd.bot/
- **Getting Started**: https://docs.clawd.bot/start/getting-started
- **ClawdHub (Skills)**: https://clawdhub.com/
- **GitHub Repo**: https://github.com/clawdbot/clawdbot

---

## Phase 1: Core Infrastructure ✓ (COMPLETE)

The foundation is built:

| Feature | Status | Location |
|---------|--------|----------|
| Voice Pipeline | ✓ Done | `src/main/voice/` |
| Wake Word Detection | ✓ Done | `src/main/voice/wake-word.ts` |
| Voice Activity Detection | ✓ Done | `src/main/voice/vad.ts` |
| Speech-to-Text | ✓ Done | `src/main/stt/` |
| LLM Integration | ✓ Done | `src/main/llm/` |
| Text-to-Speech | ✓ Done | `src/main/tts/` |
| Provider Failover | ✓ Done | Circuit breakers in all providers |
| 3D Orb Visualization | ✓ Done | `src/renderer/components/orb/` |
| Conversation Memory | ✓ Done | `src/main/memory/` |
| Basic Agent Tools | ✓ Done | `src/main/agent/tools/` |

---

## Phase 2: Gateway & Multi-Channel ✓ (IMPLEMENTED)

Gateway architecture and session management are now in place:

| Feature | Status | Location |
|---------|--------|----------|
| Gateway Server | ✓ Done | `src/main/gateway/index.ts` |
| Session Manager | ✓ Done | `src/main/gateway/sessions.ts` |
| Cron/Scheduler | ✓ Done | `src/main/gateway/cron.ts` |
| Gateway Types | ✓ Done | `src/shared/types/gateway.ts` |
| Session Tools | ✓ Done | `src/main/agent/tools/sessions.ts` |
| Cron Tools | ✓ Done | `src/main/agent/tools/cron.ts` |
| Node Tools | ✓ Done | `src/main/agent/tools/nodes.ts` |
| Web Search (Brave) | ✓ Done | `src/main/agent/tools/web-search.ts` |
| Web Fetch | ✓ Done | `src/main/agent/tools/web-fetch.ts` |

### Gateway Architecture
```
src/main/gateway/
├── index.ts              # WebSocket gateway server
├── sessions.ts           # Multi-session management
└── cron.ts               # Task scheduling system
```

### Channels to Implement

| Channel | Library | Priority | Status |
|---------|---------|----------|--------|
| Desktop | Built-in | ✓ | `src/main/channels/` |
| WebChat | Built-in | ✓ | `src/main/channels/` |
| WhatsApp | Baileys | ✓ Framework | `src/main/channels/` |
| Telegram | grammY | ✓ Framework | `src/main/channels/` |
| Discord | discord.js | ✓ Framework | `src/main/channels/` |
| Slack | Bolt SDK | ✓ Framework | `src/main/channels/` |
| iMessage | imsg CLI | Planned | - |
| Signal | signal-cli | Planned | - |
| Matrix | matrix-js-sdk | Planned | - |

### Message Tools ✓

| Tool | Description | Location |
|------|-------------|----------|
| message_send | Send to any channel | `tools/message.ts` |
| channel_list | List connected channels | `tools/message.ts` |
| channel_connect | Connect a channel | `tools/message.ts` |
| channel_disconnect | Disconnect channel | `tools/message.ts` |
| message_typing | Send typing indicator | `tools/message.ts` |
| message_react | React with emoji | `tools/message.ts` |

### Session Model

```typescript
// Session keys follow Clawdbot's pattern
type ChannelType = 
  | 'desktop'
  | 'webchat'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'slack'
  | 'imessage'
  | 'email'
  | 'api';
```

---

## Phase 3: Advanced Tools ✓ (COMPLETE)

### Browser Control ✓
Reference: [docs.clawd.bot/tools/browser](https://docs.clawd.bot/tools/browser)

| Feature | Status | Location |
|---------|--------|----------|
| CDP Browser Control | ✓ Done | `src/main/agent/tools/browser-cdp.ts` |
| Browser Agent | ✓ Done | `src/main/agent/browser-agent/` |
| Browser Module | ✓ Done | `src/main/browser/index.ts` |
| Screenshot Tools | ✓ Done | `src/main/agent/tools/screenshot.ts` |
| Screen Vision | ✓ Done | `src/main/agent/tools/screen-vision.ts` |

### Canvas/A2UI ✓
Reference: [docs.clawd.bot/platforms/mac/canvas](https://docs.clawd.bot/platforms/mac/canvas)

| Feature | Status | Location |
|---------|--------|----------|
| Canvas Module | ✓ Done | `src/main/canvas/index.ts` |
| canvas_render | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_form | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_table | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_chart | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_snapshot | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_clear | ✓ Done | `src/main/agent/tools/canvas.ts` |
| canvas_close | ✓ Done | `src/main/agent/tools/canvas.ts` |

### Cron/Scheduling ✓
Reference: [docs.clawd.bot/automation/cron-jobs](https://docs.clawd.bot/automation/cron-jobs)

| Feature | Status | Location |
|---------|--------|----------|
| Cron Parser | ✓ Done | `src/main/gateway/cron.ts` |
| Task Scheduler | ✓ Done | `src/main/gateway/cron.ts` |
| cron_schedule Tool | ✓ Done | `src/main/agent/tools/cron.ts` |
| cron_list Tool | ✓ Done | `src/main/agent/tools/cron.ts` |
| cron_cancel Tool | ✓ Done | `src/main/agent/tools/cron.ts` |
| cron_run Tool | ✓ Done | `src/main/agent/tools/cron.ts` |

### Web Tools ✓
Reference: [docs.clawd.bot/tools/web](https://docs.clawd.bot/tools/web)

| Feature | Status | Location |
|---------|--------|----------|
| web_search (Brave) | ✓ Done | `src/main/agent/tools/web-search.ts` |
| web_fetch | ✓ Done | `src/main/agent/tools/web-fetch.ts` |
| DuckDuckGo Fallback | ✓ Done | `src/main/agent/tools/web-search.ts` |
| Response Caching | ✓ Done | Both tools |

---

## Phase 4: Node System (Companion Devices) ✓ (FRAMEWORK COMPLETE)

Reference: [docs.clawd.bot/nodes](https://docs.clawd.bot/nodes)

| Feature | Status | Location |
|---------|--------|----------|
| Node Protocol | ✓ Done | `src/main/gateway/index.ts` |
| Node Pairing | ✓ Done | Gateway handlers |
| nodes_list Tool | ✓ Done | `src/main/agent/tools/nodes.ts` |
| nodes_invoke Tool | ✓ Done | `src/main/agent/tools/nodes.ts` |
| nodes_approve Tool | ✓ Done | `src/main/agent/tools/nodes.ts` |
| nodes_notify Tool | ✓ Done | `src/main/agent/tools/nodes.ts` |

### Node Protocol

```typescript
interface NodeConnection {
  id: string;
  name: string;
  platform: 'macos' | 'ios' | 'android' | 'linux' | 'windows';
  capabilities: NodeCapability[];
  permissions: Record<string, boolean>;
  status: 'online' | 'offline' | 'pending';
}

type NodeCapability = 
  | 'canvas'
  | 'camera'
  | 'screen'
  | 'location'
  | 'notifications'
  | 'system.run'
  | 'sms';
```

### Node Commands (Planned for Companion Apps)

| Command | Description | Platforms |
|---------|-------------|-----------|
| `canvas.present` | Show URL in Canvas WebView | All |
| `canvas.snapshot` | Screenshot Canvas | All |
| `camera.snap` | Take photo | iOS, Android, macOS |
| `camera.clip` | Record video | iOS, Android |
| `screen.record` | Screen recording | iOS, Android, macOS |
| `location.get` | Get GPS coordinates | iOS, Android |
| `system.run` | Execute command | macOS, Linux |
| `system.notify` | Send notification | macOS, iOS, Android |
| `sms.send` | Send SMS | Android |

---

## Phase 5: Multi-Agent System ✓ (FRAMEWORK COMPLETE)

Reference: [docs.clawd.bot/concepts/multi-agent](https://docs.clawd.bot/concepts/multi-agent)

### Session Tools ✓ (IMPLEMENTED)

| Tool | Status | Location |
|------|--------|----------|
| sessions_list | ✓ Done | `src/main/agent/tools/sessions.ts` |
| sessions_history | ✓ Done | `src/main/agent/tools/sessions.ts` |
| sessions_send | ✓ Done | `src/main/agent/tools/sessions.ts` |
| sessions_spawn | ✓ Done | `src/main/agent/tools/sessions.ts` |

```typescript
// List active sessions
sessions_list(options?: {
  channel?: ChannelType;
  state?: SessionState;
}): Promise<SessionListItem[]>;

// Get session history
sessions_history(sessionId: string, options?: {
  limit?: number;
}): Promise<ConversationTurn[]>;

// Send to another session
sessions_send(message: {
  sessionId: string;
  message: string;
  type?: 'message' | 'request' | 'notification';
}): Promise<boolean>;

// Spawn a sub-session
sessions_spawn(options?: {
  channel?: ChannelType;
  label?: string;
  initialMessage?: string;
}): Promise<Session>;
```

### Agent Routing (Planned)

```typescript
interface AgentConfig {
  id: string;
  workspace: string;
  model?: string;
  tools?: ToolConfig;
  sandbox?: SandboxConfig;
}

interface RoutingConfig {
  // Route by channel/group to specific agents
  routes: {
    pattern: string;  // e.g., 'discord:*', 'telegram:group:*'
    agentId: string;
  }[];
  
  // Default agent for unmatched
  defaultAgent: string;
}
```

---

## Phase 6: Skills Platform ✓ (ENHANCED)

Reference: [docs.clawd.bot/tools/skills](https://docs.clawd.bot/tools/skills)

| Feature | Status | Location |
|---------|--------|----------|
| Base Skill Class | ✓ Done | `src/main/agent/skills/base-skill.ts` |
| Built-in Skills | ✓ Done | `src/main/agent/skills/` |
| SKILL.md Parser | ✓ Done | `src/main/agent/skills/skill-parser.ts` |
| Skills Registry | ✓ Done | `src/main/agent/skills/skill-registry.ts` |
| Gating System | ✓ Done | In skill-parser.ts |
| Skills Tools | ✓ Done | `src/main/agent/tools/skills.ts` |

### Skills Tools ✓ (7 Tools)

| Tool | Description | Location |
|------|-------------|----------|
| skills_list | List installed skills | `tools/skills.ts` |
| skills_search | Search skills by name/tag | `tools/skills.ts` |
| skills_install | Install from local path | `tools/skills.ts` |
| skills_uninstall | Uninstall a skill | `tools/skills.ts` |
| skills_enable | Enable a skill | `tools/skills.ts` |
| skills_disable | Disable a skill | `tools/skills.ts` |
| skills_info | Get skill details | `tools/skills.ts` |

### SKILL.md Format (Example)

See `src/main/skills/homebridge/SKILL.md` for a complete example.

```markdown
---
id: skill-name
name: Human Readable Name
version: 1.0.0
description: Brief description
author: Author Name
tags: tag1, tag2
---

## Gating
- binary: required-cli - Must be installed
- env: API_KEY - Required environment variable

## Tools
### tool_name
Tool description...

## Prompts
### context_prompt
Prompt content for the agent...

## Documentation
Full documentation here...
```

### Skills Structure

```
src/main/skills/
├── homebridge/           # Smart home example
│   └── SKILL.md
└── [future skills...]
```

### Gating System

```typescript
interface SkillMetadata {
  clawdbot?: {
    requires?: {
      bins?: string[];      // Required binaries on PATH
      anyBins?: string[];   // At least one required
      env?: string[];       // Required env vars
      config?: string[];    // Required config paths
    };
    os?: ('darwin' | 'linux' | 'win32')[];
    primaryEnv?: string;    // Main API key env var
  };
}
```

---

## Phase 7: Security & Safety ✓ (COMPLETE)

Reference: [docs.clawd.bot/gateway/security](https://docs.clawd.bot/gateway/security)

### Security Modules ✓

| Feature | Status | Location |
|---------|--------|----------|
| Tool Profiles | ✓ Done | `src/main/security/tool-profiles.ts` |
| Exec Approvals | ✓ Done | `src/main/security/exec-approvals.ts` |
| DM Pairing | ✓ Done | `src/main/security/dm-pairing.ts` |
| Security Tools | ✓ Done | `src/main/agent/tools/security.ts` |

### Security Tools ✓ (10 Tools)

| Tool | Description | Location |
|------|-------------|----------|
| security_set_profile | Set tool profile for session | `tools/security.ts` |
| security_get_tools | Get available tools for session | `tools/security.ts` |
| security_list_profiles | List available tool profiles | `tools/security.ts` |
| security_set_exec_mode | Set execution approval mode | `tools/security.ts` |
| security_allow_command | Add command to allowlist | `tools/security.ts` |
| security_block_command | Add command to denylist | `tools/security.ts` |
| security_approve_sender | Approve a DM sender | `tools/security.ts` |
| security_block_sender | Block a DM sender | `tools/security.ts` |
| security_list_pending | List pending pairing requests | `tools/security.ts` |
| security_set_pairing_policy | Set DM pairing policy | `tools/security.ts` |

### Tool Profiles

```typescript
type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full';

const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  minimal: ['session_status'],
  coding: ['group:fs', 'group:runtime', 'group:sessions', 'group:memory', 'image'],
  messaging: ['group:messaging', 'sessions_list', 'sessions_history', 'sessions_send'],
  full: ['*'],
};
```

### Exec Approvals

```typescript
interface ExecApprovals {
  mode: 'deny' | 'allowlist' | 'ask' | 'full';
  allowlist: string[];  // Allowed command patterns
  denylist: string[];   // Blocked patterns (wins over allow)
}
```

### DM Pairing

```typescript
interface PairingConfig {
  policy: 'open' | 'pairing' | 'closed';
  allowFrom: string[];  // Pre-approved senders
  pendingApprovals: Map<string, PairingRequest>;
}
```

---

## Phase 8: Platform Expansion

### macOS Menu Bar App
- Gateway status indicator
- Voice wake toggle
- Quick chat access
- Settings shortcut

### iOS Companion App
- Node mode (camera, screen, location)
- Canvas WebView
- Voice wake forwarding
- Push notifications

### Android Companion App
- Node mode (camera, screen, location, SMS)
- Canvas WebView
- Voice wake
- Background service

### Remote Gateway
```bash
# SSH tunnel
ssh -N -L 18789:127.0.0.1:18789 user@host

# Tailscale Serve
tailscale serve --bg https+insecure://127.0.0.1:18789

# Tailscale Funnel (public)
tailscale funnel --bg https+insecure://127.0.0.1:18789
```

---

## Implementation Status Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Core Infrastructure | ✅ Complete | 100% |
| Phase 2: Gateway + Sessions | ✅ Complete | 95% (channels pending) |
| Phase 3: Advanced Tools | ✅ Complete | 100% |
| Phase 4: Node System | ✅ Complete | 100% |
| Phase 5: Multi-Agent | ✅ Complete | 80% (routing planned) |
| Phase 6: Skills Platform | ✅ Complete | 100% |
| Phase 7: Security & Safety | ✅ Complete | 100% |
| Phase 8: Platform Expansion | 🔵 Planned | 0% |

### Files Created

```
src/main/gateway/
├── index.ts       # WebSocket gateway server
├── sessions.ts    # Session management
└── cron.ts        # Cron scheduler

src/main/agent/tools/
├── web-search.ts  # Brave Search + DuckDuckGo
├── web-fetch.ts   # URL content extraction
├── sessions.ts    # Session tools (4 tools)
├── cron.ts        # Cron tools (4 tools)
├── nodes.ts       # Node tools (5 tools)
├── canvas.ts      # Canvas tools (7 tools)
├── skills.ts      # Skills tools (7 tools)
├── message.ts     # Message tools (6 tools)
└── security.ts    # Security tools (10 tools)

src/main/security/
├── tool-profiles.ts   # Tool access control
├── exec-approvals.ts  # Command execution approvals
└── dm-pairing.ts      # DM sender approval system

src/main/browser/
└── index.ts       # CDP browser control

src/main/canvas/
└── index.ts       # A2UI canvas system

src/main/channels/
└── index.ts       # Multi-channel adapters

src/main/agent/skills/
├── skill-parser.ts   # SKILL.md parser
└── skill-registry.ts # Skills registry

src/shared/types/
└── gateway.ts     # Gateway type definitions

src/main/skills/
└── homebridge/
    └── SKILL.md   # Example skill file
```

### Total New Tools Added

| Category | Tools | Count |
|----------|-------|-------|
| Web Tools | web_search, web_fetch | 2 |
| Session Tools | sessions_list, sessions_history, sessions_send, sessions_spawn | 4 |
| Cron Tools | cron_schedule, cron_list, cron_cancel, cron_run | 4 |
| Node Tools | nodes_list, nodes_invoke, nodes_approve, nodes_reject, nodes_notify | 5 |
| Canvas Tools | canvas_render, canvas_form, canvas_table, canvas_chart, canvas_snapshot, canvas_clear, canvas_close | 7 |
| Message Tools | message_send, channel_list, channel_connect, channel_disconnect, message_typing, message_react | 6 |
| Security Tools | security_set_profile, security_get_tools, security_list_profiles, security_set_exec_mode, security_allow_command, security_block_command, security_approve_sender, security_block_sender, security_list_pending, security_set_pairing_policy | 10 |
| Skills Tools | skills_list, skills_search, skills_install, skills_uninstall, skills_enable, skills_disable, skills_info | 7 |
| **Total** | | **45** |

---

## Next Priority Tasks

| Priority | Feature | Complexity | Status |
|----------|---------|------------|--------|
| 🔴 High | Browser Control (CDP) | High | ✅ Complete |
| 🔴 High | Canvas/A2UI System | High | ✅ Complete |
| 🟠 Medium | WhatsApp Adapter (Baileys) | Medium | ✅ Framework |
| 🟠 Medium | Telegram Adapter (grammY) | Medium | ✅ Framework |
| 🟡 Normal | Discord Adapter (discord.js) | Medium | ✅ Framework |
| 🟡 Normal | Security Hardening | Medium | ✅ Complete |
| 🟡 Normal | Skills Platform | Medium | ✅ Complete |
| 🔵 Low | Mobile Companion Apps | High | Planned |
| 🔵 Low | ClawdHub Integration | Medium | Planned |

---

## How to Contribute

1. Pick a feature from this roadmap
2. Create an issue with implementation plan
3. Reference the Clawdbot docs for API design
4. Follow the coding standards in `AGENTS.md`
5. Submit PR with tests

---

## Questions?

- **Architecture**: See `docs/ARCHITECTURE.md`
- **Coding Standards**: See `AGENTS.md`
- **Personality**: See `docs/PERSONALITY-PLAN.md`
- **Clawdbot Reference**: https://docs.clawd.bot/
