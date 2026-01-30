# Atlas Desktop — Agent Instructions

This workspace is Atlas, a voice-first AI desktop assistant. This file defines how AI agents should operate when working on this codebase.

---

## First Run

If you're new to this codebase:

1. Read `CLAUDE.md` — quick overview and key files
2. Read `docs/ARCHITECTURE.md` — full system design
3. Read `docs/API-CONTRACTS.md` — IPC channel definitions
4. Read `docs/PERSONALITY-PLAN.md` — Atlas's identity and voice
5. Explore `src/shared/types/` — TypeScript interfaces

Don't ask permission. Just read and understand.

---

## Every Session

Before making changes:

1. **Understand the context** — Read relevant files before editing
2. **Check types** — Look at `src/shared/types/` for existing interfaces
3. **Verify IPC** — Changes to main↔renderer communication need both sides updated
4. **Run checks** — `npm run typecheck` and `npm run test` for affected areas

---

## Architecture Reference

### Process Boundaries

```
MAIN PROCESS (Node.js)          RENDERER (Chromium)
├── src/main/                   ├── src/renderer/
├── Voice pipeline              ├── React UI
├── Audio I/O                   ├── 3D Orb (Three.js)
├── External APIs               ├── Settings/Dashboard
├── File system                 └── Zustand stores
├── Agent tools                 
└── Database (LanceDB, SQLite)  
        │
        └── IPC via preload.ts (contextBridge)
```

### Voice Pipeline State Machine

```
        ┌─────────────────────────────────────────────────┐
        │                                                 │
        ▼                                                 │
     ┌──────┐    wake word    ┌───────────┐              │
     │ IDLE │ ──────────────► │ LISTENING │              │
     └──────┘                 └─────┬─────┘              │
        ▲                           │                    │
        │                      VAD silence               │
        │                           │                    │
        │                           ▼                    │
        │                    ┌────────────┐              │
        │                    │ PROCESSING │              │
        │                    └─────┬──────┘              │
        │                          │                     │
        │                     LLM response               │
        │                          │                     │
        │                          ▼                     │
        │                    ┌──────────┐                │
        └────────────────────│ SPEAKING │────────────────┘
                             └──────────┘
                                  │
                             TTS complete
```

### Key Subsystems

| Subsystem | Location | Purpose |
|-----------|----------|---------|
| Wake Word | `src/main/voice/wake-word.ts` | Porcupine "Hey Atlas" detection |
| VAD | `src/main/voice/vad.ts` | Silero voice activity detection |
| STT | `src/main/stt/` | Deepgram (primary), Vosk (offline) |
| LLM | `src/main/llm/` | Fireworks DeepSeek (primary), OpenRouter |
| TTS | `src/main/tts/` | ElevenLabs (primary), Piper (offline) |
| Memory | `src/main/memory/` | LanceDB vectors, SQLite, conversation |
| Agent | `src/main/agent/` | Tools, personality, task framework |
| Orb | `src/renderer/components/orb/` | 35k particle strange attractor |

---

## Code Quality Standards

> **Every line of code should look like it was written by a senior engineer at a top tech company.**

### Documentation Requirements

**Every file MUST have a file header:**
```typescript
/**
 * @fileoverview Brief description of what this module does
 * @module module-name
 * @author Atlas Team
 * @since 1.0.0
 * 
 * @description
 * Detailed description of the module's purpose, responsibilities,
 * and how it fits into the larger system architecture.
 * 
 * @example
 * // Basic usage example
 * import { SomeClass } from './module';
 * const instance = new SomeClass();
 */
```

**Every class MUST have comprehensive JSDoc:**
```typescript
/**
 * Manages voice-to-text transcription with automatic provider failover.
 * 
 * This class implements the circuit breaker pattern to handle provider
 * failures gracefully, automatically switching to fallback providers
 * when the primary provider becomes unavailable.
 * 
 * @class STTManager
 * @implements {ISTTProvider}
 * 
 * @example
 * const manager = new STTManager({
 *   primary: new DeepgramProvider(apiKey),
 *   fallback: new VoskProvider(modelPath),
 * });
 * 
 * const transcript = await manager.transcribe(audioBuffer);
 */
export class STTManager implements ISTTProvider {
  // ...
}
```

**Every method MUST have complete documentation:**
```typescript
/**
 * Transcribes audio data to text using the configured STT provider.
 * 
 * Attempts transcription with the primary provider first. If the primary
 * provider fails or the circuit breaker is open, automatically falls back
 * to the secondary provider.
 * 
 * @async
 * @param {Buffer} audioData - Raw PCM audio data (16-bit, mono, 16kHz)
 * @param {TranscriptionOptions} [options] - Optional transcription settings
 * @param {string} [options.language='en'] - BCP-47 language code
 * @param {boolean} [options.punctuation=true] - Enable automatic punctuation
 * 
 * @returns {Promise<TranscriptionResult>} The transcription result
 * @returns {string} result.text - The transcribed text
 * @returns {number} result.confidence - Confidence score (0-1)
 * @returns {string} result.provider - Which provider was used
 * 
 * @throws {AudioFormatError} If audio data is invalid or unsupported
 * @throws {ProviderUnavailableError} If all providers fail
 * 
 * @example
 * try {
 *   const result = await manager.transcribe(audioBuffer, {
 *     language: 'en-US',
 *     punctuation: true,
 *   });
 *   console.log(`Transcribed: ${result.text} (${result.confidence})`);
 * } catch (error) {
 *   if (error instanceof AudioFormatError) {
 *     console.error('Invalid audio format');
 *   }
 * }
 */
async transcribe(
  audioData: Buffer,
  options?: TranscriptionOptions
): Promise<TranscriptionResult> {
  // Implementation
}
```

### Inline Comments Standards

**DO write comments that explain WHY, not WHAT:**
```typescript
// ✓ GOOD: Explains the reasoning
// Circuit breaker threshold is set to 5 failures because Deepgram's
// typical transient errors resolve within 3 retries, so 5 indicates
// a more serious outage that warrants switching providers.
const CIRCUIT_BREAKER_THRESHOLD = 5;

// ✗ BAD: States the obvious
// Set the threshold to 5
const CIRCUIT_BREAKER_THRESHOLD = 5;
```

**DO document complex algorithms:**
```typescript
/**
 * Calculate audio energy using RMS (Root Mean Square).
 * 
 * RMS is preferred over peak detection because it better represents
 * perceived loudness and is more robust against transient spikes.
 * The -60dB silence threshold was determined empirically to filter
 * background noise while preserving soft speech.
 */
function calculateEnergy(samples: Float32Array): number {
  // Sum of squares
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  
  // RMS calculation: sqrt(mean of squares)
  const rms = Math.sqrt(sum / samples.length);
  
  // Convert to decibels for human-readable thresholds
  // 20 * log10(rms) gives us dB relative to full scale
  return 20 * Math.log10(Math.max(rms, 1e-10));
}
```

**DO mark technical debt and TODOs properly:**
```typescript
// TODO(username): Implement retry logic for network timeouts
// Issue: #123
// Priority: High
// Deadline: 2026-02-01

// HACK: Workaround for Electron IPC serialization bug
// See: https://github.com/electron/electron/issues/12345
// Remove when Electron 29 is released

// FIXME: Race condition when multiple wake words detected simultaneously
// This should use a mutex, but current implementation just debounces

// NOTE: This function is called from both main and renderer processes
// Ensure any changes maintain cross-process compatibility

// WARNING: Do not call this method during audio playback
// It will cause feedback loops due to microphone pickup
```

### Code Style Requirements

**Use meaningful variable names:**
```typescript
// ✓ GOOD
const audioSampleRate = 16000;
const maxTranscriptionRetries = 3;
const isVoiceActivityDetected = vad.detect(audioFrame);

// ✗ BAD
const sr = 16000;
const max = 3;
const detected = vad.detect(frame);
```

**Use early returns for guard clauses:**
```typescript
// ✓ GOOD
async function processAudio(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new AudioFormatError('Buffer cannot be empty');
  }
  
  if (!this._isInitialized) {
    throw new StateError('STT manager not initialized');
  }
  
  if (this._circuitBreaker.isOpen) {
    return this._fallback.transcribe(buffer);
  }
  
  // Main logic here (not deeply nested)
  return this._primary.transcribe(buffer);
}

// ✗ BAD
async function processAudio(buffer: Buffer): Promise<string> {
  if (buffer && buffer.length > 0) {
    if (this._isInitialized) {
      if (!this._circuitBreaker.isOpen) {
        return this._primary.transcribe(buffer);
      } else {
        return this._fallback.transcribe(buffer);
      }
    } else {
      throw new StateError('STT manager not initialized');
    }
  } else {
    throw new AudioFormatError('Buffer cannot be empty');
  }
}
```

**Organize imports properly:**
```typescript
// 1. Node.js built-in modules
import { EventEmitter } from 'events';
import * as path from 'path';

// 2. External dependencies (npm packages)
import { app, ipcMain } from 'electron';
import { createClient } from '@deepgram/sdk';

// 3. Internal absolute imports (path aliases)
import { VoiceConfig } from '@shared/types/voice';
import { CircuitBreaker } from '@main/utils/circuit-breaker';

// 4. Relative imports (same module)
import { DeepgramProvider } from './providers/deepgram';
import { VoskProvider } from './providers/vosk';
```

**Error handling must be comprehensive:**
```typescript
/**
 * Custom error class for STT-specific errors.
 * Includes error codes for programmatic handling.
 */
export class STTError extends Error {
  constructor(
    message: string,
    public readonly code: STTErrorCode,
    public readonly provider?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'STTError';
    
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, STTError);
    }
  }
}

// Use specific error types
try {
  const result = await provider.transcribe(audio);
} catch (error) {
  if (error instanceof NetworkError) {
    // Retry with exponential backoff
    logger.warn('Network error, retrying...', { error, attempt });
    await this._retryWithBackoff(operation, attempt + 1);
  } else if (error instanceof AuthenticationError) {
    // Don't retry auth errors, they won't resolve
    logger.error('Authentication failed', { provider: this._primary.name });
    throw new STTError(
      'Provider authentication failed',
      STTErrorCode.AUTH_FAILED,
      this._primary.name,
      error
    );
  } else {
    // Unknown error, log full details and rethrow
    logger.error('Unexpected error during transcription', {
      error,
      stack: error.stack,
      audio: { length: audio.length, sampleRate: this._config.sampleRate },
    });
    throw error;
  }
}
```

### File Organization

```
src/
├── main/                    # Main process (Node.js)
│   ├── index.ts            # Entry point, window management
│   ├── preload.ts          # IPC bridge (window.atlas)
│   ├── voice/              # Voice pipeline components
│   ├── stt/                # Speech-to-text providers
│   ├── llm/                # Language model providers
│   ├── tts/                # Text-to-speech providers
│   ├── memory/             # Storage and retrieval
│   ├── agent/              # Tools and personality
│   ├── security/           # Permissions and sandboxing
│   └── ipc/                # IPC handlers
├── renderer/               # Renderer process (React)
│   ├── App.tsx            # Root component
│   ├── components/        # UI components
│   ├── hooks/             # React hooks
│   ├── stores/            # Zustand state
│   └── styles/            # CSS
└── shared/                # Shared code
    └── types/             # TypeScript interfaces
```

### Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Files (TS) | kebab-case | `wake-word.ts`, `voice-pipeline.ts` |
| Files (React) | PascalCase | `AtlasOrb.tsx`, `SettingsPanel.tsx` |
| Classes | PascalCase | `VoicePipeline`, `STTManager` |
| Interfaces | PascalCase | `VoiceConfig`, `IPCResult` |
| Type aliases | PascalCase | `VoiceState`, `ProviderType` |
| Functions | camelCase | `processAudio`, `getVoicePipeline` |
| Constants | SCREAMING_SNAKE | `MAX_BUFFER_SIZE`, `DEFAULT_TIMEOUT` |
| Private fields | underscore prefix | `_isRunning`, `_buffer` |
| React hooks | use prefix | `useAtlasState`, `useSettings` |

### TypeScript Patterns

```typescript
// IPC Result Pattern — ALL IPC returns this
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

// Provider Manager Pattern — STT, LLM, TTS all use this
class ProviderManager<T extends Provider> {
  private primary: T;
  private fallback: T;
  private circuitBreaker: CircuitBreaker;
  
  async execute(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await this.circuitBreaker.execute(operation);
    } catch {
      return this.fallback.execute(operation);
    }
  }
}

// Singleton Pattern — Heavy modules use lazy init
let instance: HeavyModule | null = null;
export function getModule(): HeavyModule {
  if (!instance) instance = new HeavyModule();
  return instance;
}
export function shutdownModule(): void {
  instance?.shutdown();
  instance = null;
}

// Tool Definition Pattern
interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (params: Record<string, unknown>) => Promise<ActionResult>;
}
```

### Path Aliases

Always use path aliases instead of relative imports:

```typescript
// ✓ Good
import { VoiceConfig } from '@shared/types/voice';
import { STTManager } from '@main/stt/manager';

// ✗ Bad
import { VoiceConfig } from '../../../shared/types/voice';
```

### Prettier Settings

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "always"
}
```

---

## IPC Contracts

### Main Channels (Renderer → Main)

| Channel | Purpose |
|---------|---------|
| `atlas:start` | Start voice pipeline |
| `atlas:stop` | Stop voice pipeline |
| `atlas:trigger-wake` | Manual wake (push-to-talk) |
| `atlas:send-text` | Bypass STT, send text directly |
| `atlas:get-status` | Get pipeline status |
| `settings:get` | Retrieve settings |
| `settings:set` | Update settings |

### Event Channels (Main → Renderer)

| Channel | Purpose |
|---------|---------|
| `atlas:state-change` | Pipeline state changed (idle/listening/processing/speaking) |
| `atlas:transcript` | Speech transcript ready |
| `atlas:response` | LLM response (streaming chunks) |
| `atlas:audio-level` | Microphone level (~30fps for visualization) |
| `atlas:error` | Error occurred |

### Adding New IPC

1. Define types in `src/shared/types/ipc.ts`
2. Add handler in `src/main/ipc/handlers.ts`
3. Expose in `src/main/preload.ts`
4. Use via `window.atlas` in renderer

---

## Testing

### Test Configuration

- **Framework**: Vitest 1.1
- **Environment**: Node (not jsdom for main process tests)
- **Coverage Target**: 80% lines/statements/functions, 70% branches
- **Pattern**: `tests/**/*.test.ts`

### Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ModuleName', () => {
  beforeEach(() => {
    // Setup mocks, reset state
  });

  afterEach(() => {
    // Cleanup, restore mocks
  });

  describe('methodName', () => {
    it('should do expected behavior', () => {
      const result = someFunction();
      expect(result).toBe(expected);
    });

    it('should handle edge case', () => {
      expect(() => someFunction(badInput)).toThrow();
    });
  });
});
```

### Mocking Electron

```typescript
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn() },
  })),
}));
```

---

## Safety & Permissions

### Agent Tool Safety

```typescript
// Tools must declare their risk level
interface AgentTool {
  name: string;
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  requiresConfirmation: boolean;
  // ...
}

// Dangerous operations require user confirmation
if (tool.riskLevel === 'dangerous' && !userConfirmed) {
  throw new PermissionDeniedError();
}
```

### File System Rules

- **Safe**: Read files in workspace, temp directories
- **Moderate**: Write to user-specified locations
- **Dangerous**: System directories, executables

### External API Rules

- All API keys stored in OS keychain via `keytar`
- Never log API keys or sensitive data
- Circuit breakers prevent runaway API usage

---

## Commit Guidelines

### Format

```
type(scope): short description

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring |
| `perf` | Performance improvement |
| `test` | Adding/fixing tests |
| `chore` | Build, CI, dependencies |

### Scopes

| Scope | Area |
|-------|------|
| `voice` | Voice pipeline |
| `stt` | Speech-to-text |
| `tts` | Text-to-speech |
| `llm` | Language models |
| `orb` | 3D visualization |
| `agent` | Tools and personality |
| `memory` | Storage systems |
| `security` | Permissions |
| `ui` | General UI |
| `ipc` | IPC channels |

### Examples

```
feat(voice): add custom wake word training

- Add WakeWordTrainer class
- Add UI for recording samples
- Update voice pipeline to use custom model

Closes #123
```

```
fix(stt): handle empty audio buffer gracefully

Previously threw uncaught exception when audio
buffer was empty. Now returns empty string.
```

---

## Common Tasks

### Adding a New Tool

1. Create file in `src/main/agent/tools/`
2. Implement `AgentTool` interface
3. Register in `src/main/agent/tools/index.ts`
4. Add tests in `tests/`

### Adding a New Provider (STT/LLM/TTS)

1. Create provider class implementing base interface
2. Add to manager's provider list
3. Update config types in `src/shared/types/`
4. Add feature flag in settings

### Adding a New IPC Channel

1. Define types in `src/shared/types/ipc.ts`
2. Add handler in `src/main/ipc/`
3. Expose in preload: `src/main/preload.ts`
4. Create hook in renderer if needed

### Modifying the Orb

1. Shaders: `src/renderer/components/orb/shaders/`
2. Particle system: `AtlasParticles.tsx`
3. State colors defined in particle material
4. GPU tier affects particle count (see `gpu-detection.ts`)

---

## Environment Variables

```bash
# Required for voice features
PORCUPINE_API_KEY=     # Picovoice wake word
DEEPGRAM_API_KEY=      # Primary STT
FIREWORKS_API_KEY=     # Primary LLM
ELEVENLABS_API_KEY=    # Primary TTS

# Optional fallbacks
OPENROUTER_API_KEY=    # Fallback LLM
```

---

## Data Locations

| Data | Location |
|------|----------|
| Vector DB | `{userData}/lancedb/` |
| SQLite | `{userData}/atlas.db` |
| Logs | `{userData}/logs/` |
| Config | `{userData}/config.json` |
| Credentials | OS Keychain (via keytar) |

Where `{userData}` = `app.getPath('userData')`

---

## Debugging

### Voice Pipeline

```typescript
// Enable debug logging
process.env.ATLAS_DEBUG_VOICE = 'true';

// Manual wake trigger
window.atlas.atlas.triggerWake();

// Check state
const status = await window.atlas.atlas.getStatus();
console.log(status);
```

### IPC Issues

```typescript
// In renderer console
window.atlas.on('atlas:state-change', (state) => {
  console.log('State changed:', state);
});
```

### Memory Leaks

```bash
# Run with heap inspection
node --inspect dist/main.js
```

---

## Don't Forget

- [ ] Run `npm run typecheck` before committing
- [ ] Run `npm run test` for affected modules
- [ ] Update types if changing interfaces
- [ ] Update both main and renderer for IPC changes
- [ ] Keep `electron-builder.yml` asarUnpack list current for native modules
- [ ] Atlas is a friend, not a robot — keep the personality consistent
- [ ] Write professional comments explaining WHY, not WHAT
- [ ] Add JSDoc to all public classes and methods
- [ ] Use meaningful variable names (no single letters except loop indices)
- [ ] Handle all error cases explicitly

---

## Feature Roadmap (Clawdbot-Inspired)

The following features are planned for Atlas, inspired by [Clawdbot](https://github.com/clawdbot/clawdbot):

### Phase 1: Core Infrastructure ✓
- [x] Voice pipeline (wake word → VAD → STT → LLM → TTS)
- [x] Provider failover with circuit breakers
- [x] 3D Orb visualization
- [x] Basic agent tools (filesystem, terminal)
- [x] Conversation memory (LanceDB + SQLite)

### Phase 2: Multi-Channel Communication
- [ ] **Gateway Architecture** — Single control plane for all channels
  - WebSocket server for clients/nodes
  - Session management and routing
  - Heartbeat and presence system
- [ ] **WhatsApp Integration** — Baileys protocol, QR pairing
- [ ] **Telegram Bot** — grammY, DMs + groups
- [ ] **Discord Bot** — discord.js, servers + DMs
- [ ] **iMessage** — macOS native integration
- [ ] **WebChat UI** — Browser-based chat interface

### Phase 3: Advanced Tools
- [ ] **Browser Control** — CDP-based browser automation
  - Dedicated browser profile
  - Snapshots, screenshots, actions
  - Multi-tab management
- [ ] **Canvas/A2UI** — Agent-driven visual workspace
  - HTML rendering surface
  - A2UI protocol support
  - Screenshot/snapshot capture
- [ ] **Cron/Scheduling** — Background task automation
  - Cron job management
  - Wakeups and heartbeats
  - Scheduled messages
- [ ] **Web Tools** — Search and fetch
  - Brave Search integration
  - URL content extraction
  - Response caching

### Phase 4: Node System (Companion Devices)
- [ ] **Node Protocol** — WS-based device connection
  - Device pairing and approval
  - Capability advertisement
  - Command routing
- [ ] **Camera Integration** — Snap, clip, stream
- [ ] **Screen Recording** — Capture and share
- [ ] **Location Services** — GPS/location data
- [ ] **System Commands** — Run commands on nodes
- [ ] **Notifications** — Push to companion devices

### Phase 5: Multi-Agent System
- [ ] **Session Isolation** — Per-channel/group sessions
- [ ] **Agent Routing** — Route conversations to different agents
- [ ] **Agent-to-Agent** — Inter-session communication
  - `sessions_list`, `sessions_history`
  - `sessions_send`, `sessions_spawn`
- [ ] **Sandboxing** — Docker-based isolation for untrusted sessions

### Phase 6: Skills Platform
- [ ] **Skills Format** — AgentSkills-compatible SKILL.md
- [ ] **Skills Registry** — Install/update/manage skills
- [ ] **Gating System** — Binary/env/config requirements
- [ ] **Skills UI** — Browse and configure skills
- [ ] **ClawdHub Integration** — Public skills registry

### Phase 7: Security & Safety
- [ ] **Tool Profiles** — Allowlist/denylist tool sets
- [ ] **Exec Approvals** — Per-command approval system
- [ ] **DM Pairing** — Approve unknown senders
- [ ] **Audit Logging** — Track all actions
- [ ] **Rate Limiting** — Prevent abuse

### Phase 8: Platform Expansion
- [ ] **macOS Menu Bar App** — Control plane + voice wake
- [ ] **iOS Companion** — Node mode + Canvas
- [ ] **Android Companion** — Node mode + Canvas
- [ ] **Linux Service** — systemd integration
- [ ] **Remote Gateway** — SSH tunnel / Tailscale support

---

## Tool Inventory (Target Feature Set)

| Tool | Description | Priority |
|------|-------------|----------|
| `exec` | Run shell commands | ✓ Done |
| `process` | Manage background processes | ✓ Done |
| `read`/`write`/`edit` | File operations | ✓ Done |
| `web_search` | Brave Search API | High |
| `web_fetch` | URL content extraction | High |
| `browser` | CDP browser control | High |
| `canvas` | Visual workspace | Medium |
| `nodes` | Companion device control | Medium |
| `cron` | Scheduled tasks | Medium |
| `message` | Multi-channel messaging | High |
| `sessions_*` | Agent-to-agent comms | Medium |
| `image` | Image analysis | Medium |
| `memory_*` | Memory search/retrieval | ✓ Done |
| `gateway` | Gateway control | Low |
