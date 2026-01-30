# .agent/ — AI Agent Workspace

This folder contains files for AI agents working on the Atlas Desktop codebase.

## Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Atlas's identity, personality, and voice guidelines |
| `TOOLS.md` | Environment-specific notes and configuration |
| `MEMORY.md` | Long-term memory and learned preferences |
| `memory/` | Daily logs (YYYY-MM-DD.md format) |

## Usage

### For AI Agents (Claude, Copilot, etc.)

1. Read `../CLAUDE.md` first — quick codebase overview
2. Read `../AGENTS.md` — detailed conventions and patterns
3. Read `SOUL.md` — understand Atlas's personality
4. Check `TOOLS.md` — environment-specific details
5. Check `MEMORY.md` — context about the user

### For Developers

These files help AI agents understand:
- **What Atlas is** — A voice-first AI desktop assistant
- **How Atlas speaks** — Friend-like, not robotic
- **How to code here** — Conventions, patterns, gotchas
- **What to remember** — User preferences and context

## Inspired By

This structure is inspired by [Clawdbot](https://github.com/clawdbot/clawdbot)'s agent workspace pattern:
- Session-based continuity via files
- Separation of identity (SOUL), tools (TOOLS), and memory (MEMORY)
- Clear conventions for AI agents to follow

## Memory System

```
.agent/
├── SOUL.md           # Identity (rarely changes)
├── TOOLS.md          # Environment config (changes with setup)
├── MEMORY.md         # Curated long-term memory
└── memory/           # Daily logs
    ├── 2026-01-26.md
    ├── 2026-01-25.md
    └── ...
```

Daily logs capture raw events. `MEMORY.md` captures distilled wisdom.

## Adding Notes

When something important happens:
1. Log it in `memory/YYYY-MM-DD.md`
2. If it's worth keeping long-term, add to `MEMORY.md`

When learning environment details:
- Add to `TOOLS.md`

When refining personality:
- Update `SOUL.md` (and note the change)
