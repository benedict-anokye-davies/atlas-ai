# Atlas Desktop — AI Agent Instructions

> **This file is your entry point.** Read it first, then follow the references.

## Quick Start

1. Read this file completely
2. Read `AGENTS.md` for detailed conventions
3. Read `docs/ARCHITECTURE.md` for system design
4. Read `docs/API-CONTRACTS.md` for IPC channels

## What Is Atlas?

Atlas is a **voice-first AI desktop assistant** built with Electron. It's a friend first, assistant second—not a productivity robot, but a supportive presence that knows the user, remembers their struggles, and helps without judgment.

**Stack**: Electron 28 + React 18 + TypeScript 5.3 + Vite 5 + Three.js (3D orb visualization)

## Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js)                   │
│  Entry: src/main/index.ts                                   │
│  • Voice pipeline (wake word → VAD → STT → LLM → TTS)       │
│  • Audio capture, external APIs, agent tools                │
│  • File system access, security enforcement                 │
└───────────────────────┬─────────────────────────────────────┘
                        │ IPC (contextBridge)
┌───────────────────────┴─────────────────────────────────────┐
│                   PRELOAD (src/main/preload.ts)             │
│  • Exposes window.atlas API                                 │
│  • Type-safe IPC bridge (~3500 lines)                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────────┐
│                 RENDERER (React)                             │
│  Entry: src/renderer/main.tsx → App.tsx                     │
│  • 3D Orb visualization (AtlasOrb, AtlasParticles)          │
│  • Settings, Dashboard, UI components                       │
│  • Zustand state stores                                     │
└─────────────────────────────────────────────────────────────┘
```

## Voice Pipeline Flow

```
Microphone → Wake Word → VAD → STT → LLM → TTS → Speaker
             (Porcupine)  (Silero) (Deepgram) (Fireworks) (ElevenLabs)
                 ↓
            "Hey Atlas"
               detected

State Machine: idle → listening → processing → speaking → idle
```

## Text Chat (No Voice)

For text-only interaction, the simpler path is used:
```
Text Input → handlers.ts → simple-chat-tools.ts → LLM (Kimi K2.5) → Tool Execution → Response
```

Key file: `src/main/chat/simple-chat-tools.ts`

## LLM Configuration

**Primary Model**: Kimi K2.5 via Fireworks AI
- Model ID: `accounts/fireworks/models/kimi-k2p5`
- 1 trillion parameters (MoE)
- 256K context window
- Tool/function calling support
- Vision support
- $0.60-$1.20 per million tokens

**Fallback**: DeepSeek V3, GLM-4.7

**Smart Router**: `src/main/llm/smart-router.ts` handles task complexity detection and model selection.


## Key Directories

| Path | Purpose |
|------|---------|
| `src/main/` | Electron main process (60+ modules) |
| `src/main/voice/` | Wake word, VAD, audio pipeline |
| `src/main/stt/` | Speech-to-text providers |
| `src/main/llm/` | LLM providers (Fireworks, OpenRouter) |
| `src/main/tts/` | Text-to-speech providers |
| `src/main/memory/` | LanceDB vector store, conversation memory |
| `src/main/agent/` | Tools, skills, personality, task framework |
| `src/renderer/` | React frontend |
| `src/renderer/components/orb/` | 3D visualization (35k particles) |
| `src/shared/types/` | TypeScript interfaces (25+ files) |
| `tests/` | Vitest unit tests |
| `docs/` | Architecture, API, guides |

## Critical Files

| File | What It Does |
|------|--------------|
| `src/main/index.ts` | Main process entry (~1400 lines) |
| `src/main/preload.ts` | IPC API bridge (~3500 lines) |
| `src/main/voice/voice-pipeline.ts` | Voice orchestrator (state machine) |
| `src/renderer/App.tsx` | Main React component |
| `src/renderer/hooks/useAtlasState.ts` | Voice state hook |
| `src/shared/types/` | All TypeScript interfaces |

## Commands

```bash
npm run dev          # Start development (Vite + Electron)
npm run build        # Production build
npm run test         # Run Vitest tests
npm run typecheck    # TypeScript checking
npm run lint         # ESLint with auto-fix
npm run dist:win     # Build Windows installer
```

## TypeScript Path Aliases

```typescript
import { Something } from '@main/module';     // → src/main/
import { Type } from '@shared/types/module';  // → src/shared/types/
import { Component } from '@/components/...'; // → src/renderer/
```

## Coding Conventions

> **Code must read like it was written by a senior engineer at Google/Meta/Apple.**

### Documentation Requirements

1. **File headers** — Every file needs `@fileoverview`, `@module`, `@description`
2. **Class docs** — Full JSDoc with `@class`, `@implements`, `@example`
3. **Method docs** — `@param`, `@returns`, `@throws`, `@example` for all public methods
4. **Inline comments** — Explain WHY, not WHAT. Document complex algorithms.

### Comment Standards

```typescript
// ✓ GOOD: Explains reasoning
// Circuit breaker opens after 5 failures because Deepgram's transient
// errors typically resolve within 3 retries — 5 indicates a real outage.
const CIRCUIT_BREAKER_THRESHOLD = 5;

// ✗ BAD: States the obvious
// Set threshold to 5
const CIRCUIT_BREAKER_THRESHOLD = 5;
```

### Required Comment Tags

- `TODO(username): Description` — Planned work with owner
- `FIXME: Description` — Known bugs that need fixing
- `HACK: Description` — Workarounds (include issue link)
- `NOTE: Description` — Important context for future readers
- `WARNING: Description` — Dangerous operations or gotchas

See `AGENTS.md` for complete code quality standards.

## IPC Pattern

All IPC returns this shape:

```typescript
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
```

## Key Patterns

### 1. Provider Manager (Circuit Breaker + Fallback)
```typescript
// STT, LLM, TTS all use this pattern
class STTManager {
  private primary: DeepgramProvider;
  private fallback: VoskProvider;
  
  async transcribe(audio: Buffer): Promise<string> {
    try {
      return await this.circuitBreaker.execute(() => 
        this.primary.transcribe(audio)
      );
    } catch {
      return this.fallback.transcribe(audio);
    }
  }
}
```

### 2. Singleton with Lazy Loading
```typescript
let instance: VoicePipeline | null = null;

export function getVoicePipeline(): VoicePipeline {
  if (!instance) instance = new VoicePipeline(getConfig());
  return instance;
}

export function shutdownVoicePipeline(): void {
  instance?.shutdown();
  instance = null;
}
```

### 3. Tool Definition
```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (params: Record<string, unknown>) => Promise<ActionResult>;
}
```

## Gotchas

1. **Native Modules**: Picovoice, better-sqlite3, sharp require node-gyp. Keep `asarUnpack` list updated in `electron-builder.yml`.

2. **Dual TSConfig**: 
   - `tsconfig.json` → Renderer (React)
   - `tsconfig.main.json` → Main process (Node)

3. **Lazy Loading**: Main process uses `require()` for heavy modules to improve startup time.

4. **GPU Tier Detection**: Orb auto-adjusts particle count based on detected GPU.

5. **EPIPE Handling**: Global error handlers in main prevent crashes during hot-reload.

6. **R3F Props**: ESLint configured to ignore React Three Fiber props like `attach`, `args`, `position`.

## Commit Format

```
type(scope): description

feat|fix|docs|style|refactor|perf|test|chore
(voice|stt|tts|llm|orb|agent|memory|security|ui)
```

Example: `feat(voice): add custom wake word training`

## Before You Code

1. Check `docs/ARCHITECTURE.md` for system design
2. Check `docs/API-CONTRACTS.md` for IPC channels
3. Check `src/shared/types/` for existing interfaces
4. Run `npm run typecheck` before committing
5. Run `npm run test` for affected areas

## Personality Note

Atlas is configured as a **friend, not a robot**. When working on user-facing features:
- Use contractions (I'm, you're, don't)
- Keep sentences short and natural
- No corporate jargon or "assistant-speak"
- See `docs/PERSONALITY-PLAN.md` for full guidelines

---

## Feature Roadmap

Atlas is evolving to include features inspired by [Clawdbot](https://github.com/clawdbot/clawdbot):

### Coming Soon
- **Multi-Channel Communication** — WhatsApp, Telegram, Discord, iMessage, WebChat
- **Gateway Architecture** — WebSocket control plane for all clients/nodes
- **Browser Automation** — CDP-based browser control with snapshots/actions
- **Cron/Scheduling** — Background tasks and heartbeats
- **Node System** — Companion devices (iOS/Android) with camera/screen capture
- **Skills Platform** — AgentSkills-compatible skill system
- **Multi-Agent Routing** — Session isolation and agent-to-agent communication

See `AGENTS.md` for the complete feature roadmap with implementation priorities.

### Reference Links
- [Clawdbot Docs](https://docs.clawd.bot/) — Feature reference
- [ClawdHub](https://clawdhub.com/) — Skills registry
- [Clawdbot GitHub](https://github.com/clawdbot/clawdbot) — Source code
