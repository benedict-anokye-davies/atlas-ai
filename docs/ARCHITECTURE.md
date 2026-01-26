# Atlas Desktop - Architecture Overview

> **Version:** 0.2.0
> **Last Updated:** January 15, 2026
> **Type:** Electron + React + TypeScript Voice-First AI Desktop Assistant

This document provides a comprehensive overview of Atlas Desktop's architecture, including system design, data flow, component interactions, and key patterns.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Process Model](#process-model)
4. [Voice Pipeline Architecture](#voice-pipeline-architecture)
5. [Provider Architecture](#provider-architecture)
6. [IPC Communication](#ipc-communication)
7. [State Management](#state-management)
8. [Memory System](#memory-system)
9. [Security Architecture](#security-architecture)
10. [Technology Stack](#technology-stack)
11. [Design Patterns](#design-patterns)
12. [Performance Architecture](#performance-architecture)

---

## System Overview

Atlas Desktop is a voice-first AI assistant that enables natural language interaction through voice commands. The system follows a modular architecture with clear separation of concerns between the Electron main process (backend services) and the React renderer process (user interface).

### Key Capabilities

- **Wake Word Detection** - Always-listening "Hey Atlas" activation
- **Voice Activity Detection** - Intelligent speech boundary detection
- **Speech-to-Text** - Real-time transcription with streaming
- **LLM Processing** - Intelligent response generation with tool use
- **Text-to-Speech** - Natural voice synthesis
- **Agent Tools** - File system, terminal, browser automation
- **Memory System** - Conversation persistence and semantic search
- **Visual Feedback** - 3D particle orb visualization

---

## High-Level Architecture

```
+==============================================================================+
|                              ATLAS DESKTOP                                    |
|                    Voice-First AI Desktop Assistant                           |
+==============================================================================+
|                                                                               |
|  +-------------------------------------------------------------------------+ |
|  |                        RENDERER PROCESS (React)                         | |
|  |                                                                         | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |   |    App.tsx        |    |   AtlasOrb.tsx   |    |AtlasParticles  |   | |
|  |   |  (Main UI Entry)  |<-->| (3D Canvas Wrap) |<-->| (Attractor Viz)|   | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |            |                       |                      |             | |
|  |            v                       v                      v             | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |   | useAtlasState.ts  |    |  attractors.ts   |    |   shaders.ts   |   | |
|  |   | (IPC State Hook)  |    | (Aizawa Math)    |    | (GLSL Shaders) |   | |
|  |   +-------------------+    +------------------+    +----------------+   | |
|  |            |                                                            | |
|  +------------|------------------------------------------------------------+ |
|               | IPC (contextBridge)                                          |
|               v                                                              |
|  +-------------------------------------------------------------------------+ |
|  |                         PRELOAD SCRIPT                                  | |
|  |                        (preload.ts)                                     | |
|  |   window.atlas = { start, stop, triggerWake, sendText, ... }           | |
|  +-------------------------------------------------------------------------+ |
|               |                                                              |
|               v                                                              |
|  +-------------------------------------------------------------------------+ |
|  |                         MAIN PROCESS (Electron)                         | |
|  |                                                                         | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |  |      IPC Handlers         |  |           System Tray              |  | |
|  |  |      (handlers.ts)        |  |         (tray/index.ts)            |  | |
|  |  |  atlas:start, atlas:stop, |  |  Push-to-talk, Show/Hide Window   |  | |
|  |  |  atlas:trigger-wake, ...  |  |                                    |  | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |               |                              |                          | |
|  |               +----------+-------------------+                          | |
|  |                          |                                              | |
|  |                          v                                              | |
|  |  +-------------------------------------------------------------------+  | |
|  |  |                    VOICE PIPELINE                                 |  | |
|  |  |                 (voice-pipeline.ts)                               |  | |
|  |  |              Central Orchestrator                                 |  | |
|  |  |                                                                   |  | |
|  |  |   State Machine: idle -> listening -> processing -> speaking     |  | |
|  |  +-------------------------------------------------------------------+  | |
|  |               |           |           |           |                     | |
|  |               v           v           v           v                     | |
|  |  +-----------+  +--------+  +--------+  +--------+  +---------+        | |
|  |  | Audio     |  |  STT   |  |  LLM   |  |  TTS   |  | Memory  |        | |
|  |  | Pipeline  |  |Manager |  |Manager |  |Manager |  | Manager |        | |
|  |  +-----------+  +--------+  +--------+  +--------+  +---------+        | |
|  |                                                                         | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |  |      Agent System         |  |          Security Layer            |  | |
|  |  |     (agent/index.ts)      |  |       (security/index.ts)          |  | |
|  |  |  Tools: filesystem,       |  |  Input validation, rate limiting,  |  | |
|  |  |    terminal, git          |  |  command sandboxing               |  | |
|  |  +---------------------------+  +------------------------------------+  | |
|  |                                                                         | |
|  +-------------------------------------------------------------------------+ |
|                                                                               |
+===============================================================================+
```

---

## Process Model

Atlas uses Electron's multi-process architecture for security and performance:

### Main Process

The main process runs Node.js and handles:
- Voice pipeline orchestration
- Audio capture and playback
- External API communication (STT, LLM, TTS)
- File system access
- System tray management
- IPC handler registration
- Security enforcement

**Entry Point:** `src/main/index.ts`

### Renderer Process

The renderer process runs in a sandboxed Chromium context:
- React application
- 3D visualization (React Three Fiber)
- User interface components
- State management (Zustand)
- IPC client calls

**Entry Point:** `src/renderer/main.tsx`

### Preload Script

The preload script bridges main and renderer:
- Exposes safe IPC methods via `contextBridge`
- Provides `window.atlas` API
- Runs with Node.js access but limited scope

**Entry Point:** `src/main/preload.ts`

```typescript
// Preload exposes safe API to renderer
contextBridge.exposeInMainWorld('atlas', {
  start: (config) => ipcRenderer.invoke('atlas:start', config),
  stop: () => ipcRenderer.invoke('atlas:stop'),
  triggerWake: () => ipcRenderer.invoke('atlas:trigger-wake'),
  sendText: (text) => ipcRenderer.invoke('atlas:send-text', text),
  on: (channel, callback) => {
    ipcRenderer.on(channel, callback);
    return () => ipcRenderer.removeListener(channel, callback);
  },
  // ... more methods
});
```

---

## Voice Pipeline Architecture

The voice pipeline is the heart of Atlas, orchestrating the complete voice interaction flow:

### Pipeline Flow

```
                              AUDIO INPUT FLOW
+-----------------------------------------------------------------------------+
|                                                                             |
|   [Microphone]                                                              |
|        |                                                                    |
|        v                                                                    |
|   +---------+     +-----------+     +-------+     +-------+                |
|   |PvRecorder|---->| Wake Word |---->|  VAD  |---->|  STT  |                |
|   | (Audio)  |     |(Porcupine)|     |(Silero)|    |Manager|                |
|   +---------+     +-----------+     +-------+     +-------+                |
|        |              |                 |             |                     |
|        |         "Hey Atlas"        Speech        Transcript                |
|        |          Detected          Segment          |                      |
|        v              |                 |             v                     |
|   +--------+          +--------->-------+------>+----------+               |
|   | Audio  |                                    | Deepgram |<-- Primary    |
|   | Level  |                                    +----------+               |
|   | Events |                                         |                      |
|   +--------+                                    +----------+               |
|                                                 |   Vosk   |<-- Fallback   |
|                                                 +----------+               |
|                                                                             |
+-----------------------------------------------------------------------------+

                              RESPONSE OUTPUT FLOW
+-----------------------------------------------------------------------------+
|                                                                             |
|   [Transcript]                                                              |
|        |                                                                    |
|        v                                                                    |
|   +----------+     +----------+     +----------+     +----------+          |
|   |   LLM    |---->| Streaming|---->|   TTS    |---->|  Audio   |          |
|   | Manager  |     | Response |     | Manager  |     |  Output  |          |
|   +----------+     +----------+     +----------+     +----------+          |
|        |                                  |              |                  |
|        v                                  v              v                  |
|   +-----------+                     +-----------+   [Speaker]              |
|   | Fireworks |<-- Primary          | ElevenLabs|<-- Primary               |
|   +-----------+                     +-----------+                          |
|        |                                  |                                 |
|   +-----------+                     +-----------+                          |
|   |OpenRouter |<-- Fallback         | Piper/    |<-- Fallback              |
|   +-----------+                     | espeak    |                          |
|                                     +-----------+                          |
|                                                                             |
+-----------------------------------------------------------------------------+
```

### State Machine

```
                         VOICE PIPELINE STATES
+-------------------------------------------------------------------------+
|                                                                         |
|                            +--------+                                   |
|                            |  IDLE  |<-----------+                      |
|                            +---+----+            |                      |
|                                |                 |                      |
|                    Wake Word / Push-to-Talk      |                      |
|                                |                 |                      |
|                                v                 |                      |
|                         +-----------+            |                      |
|                   +---->| LISTENING |            |                      |
|                   |     +-----+-----+            |                      |
|                   |           |                  |                      |
|           Barge-in       Speech End         TTS Complete                |
|                   |           |                  |                      |
|                   |           v                  |                      |
|                   |    +------------+            |                      |
|                   +----| PROCESSING |            |                      |
|                        +-----+------+            |                      |
|                              |                   |                      |
|                        LLM Complete              |                      |
|                              |                   |                      |
|                              v                   |                      |
|                        +----------+              |                      |
|                        | SPEAKING |------------->+                      |
|                        +----------+                                     |
|                                                                         |
|   ERROR state can be entered from any state and returns to IDLE         |
|                                                                         |
+-------------------------------------------------------------------------+
```

### Component Details

| Component | File | Purpose |
|-----------|------|---------|
| VoicePipeline | `voice-pipeline.ts` | Central orchestrator, state machine |
| AudioPipeline | `pipeline.ts` | Audio capture, wake word + VAD |
| WakeWordDetector | `wake-word.ts` | Porcupine "Hey Atlas" detection |
| VADProcessor | `vad.ts` | Silero voice activity detection |
| STTManager | `stt/manager.ts` | Speech-to-text provider management |
| LLMManager | `llm/manager.ts` | LLM provider management |
| TTSManager | `tts/manager.ts` | Text-to-speech provider management |

---

## Provider Architecture

All external service providers follow a consistent pattern with automatic failover:

```
+-------------------------------------------------------------------------+
|                         PROVIDER MANAGER PATTERN                         |
+-------------------------------------------------------------------------+
|                                                                         |
|   +-------------------+                                                 |
|   |   Manager Layer   |                                                 |
|   |  (STT/LLM/TTS)    |                                                 |
|   +--------+----------+                                                 |
|            |                                                            |
|            v                                                            |
|   +--------+----------+        +--------------------+                   |
|   |  Circuit Breaker  |<------>|   State Machine    |                   |
|   |                   |        |                    |                   |
|   |  Failure Count: 3 |        |  CLOSED  (normal)  |                   |
|   |  Timeout: 60s     |        |  OPEN    (tripped) |                   |
|   |                   |        |  HALF-OPEN (test)  |                   |
|   +--------+----------+        +--------------------+                   |
|            |                                                            |
|   +--------+----------------------------+                               |
|   |                                     |                               |
|   v                                     v                               |
|   +----------------+          +------------------+                      |
|   |    PRIMARY     |          |     FALLBACK     |                      |
|   |    PROVIDER    |          |     PROVIDER     |                      |
|   |                |          |                  |                      |
|   |  - Deepgram    |          |  - Vosk          |                      |
|   |  - Fireworks   |          |  - OpenRouter    |                      |
|   |  - ElevenLabs  |          |  - Piper/espeak  |                      |
|   +----------------+          +------------------+                      |
|         |                            |                                  |
|         |  API Call                  |  Local/API Call                  |
|         v                            v                                  |
|   [ Cloud Service ]          [ Local Model / Backup API ]               |
|                                                                         |
+-------------------------------------------------------------------------+
```

### Provider Interfaces

```typescript
// STT Provider Interface
interface STTProvider {
  name: string;
  status: STTStatus;
  initialize(): Promise<void>;
  startStreaming(): Promise<void>;
  stopStreaming(): Promise<void>;
  processAudio(chunk: Buffer): void;
  getTranscript(): string;
  shutdown(): Promise<void>;
  on(event: 'transcript', cb: (result: TranscriptionResult) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;
}

// LLM Provider Interface
interface LLMProvider {
  name: string;
  status: LLMStatus;
  initialize(): Promise<void>;
  chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<LLMChunk>;
  shutdown(): Promise<void>;
}

// TTS Provider Interface
interface TTSProvider {
  name: string;
  status: TTSStatus;
  initialize(): Promise<void>;
  synthesize(text: string): Promise<TTSSynthesisResult>;
  synthesizeStream(text: string): AsyncIterable<TTSAudioChunk>;
  stop(): void;
  shutdown(): Promise<void>;
}
```

### Circuit Breaker

Automatic failure detection and recovery:

```typescript
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailure: number = 0;

  private readonly failureThreshold = 3;
  private readonly timeout = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailure = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }
}
```

---

## IPC Communication

Secure communication between main and renderer processes:

```
+-------------------------------------------------------------------------+
|                        IPC CHANNEL MAPPING                               |
+-------------------------------------------------------------------------+
|                                                                         |
|   RENDERER (invoke)                      MAIN (handle)                  |
|   ------------------                     ---------------                |
|                                                                         |
|   atlas:start          -----------------> Start voice pipeline          |
|   atlas:stop           -----------------> Stop voice pipeline           |
|   atlas:shutdown       -----------------> Full shutdown                 |
|   atlas:get-status     -----------------> Get current status            |
|   atlas:trigger-wake   -----------------> Manual wake (PTT)             |
|   atlas:send-text      -----------------> Bypass STT, send text         |
|   atlas:clear-history  -----------------> Clear conversation            |
|   atlas:get-context    -----------------> Get conversation context      |
|   atlas:get-metrics    -----------------> Get interaction metrics       |
|   atlas:update-config  -----------------> Update pipeline config        |
|                                                                         |
|   MAIN (send)                            RENDERER (on)                  |
|   -----------                            -------------                  |
|                                                                         |
|   atlas:state-change   -----------------> Pipeline state changed        |
|   atlas:wake-word      -----------------> Wake word detected            |
|   atlas:speech-start   -----------------> User started speaking         |
|   atlas:speech-end     -----------------> User stopped speaking         |
|   atlas:transcript-*   -----------------> Interim/final transcript      |
|   atlas:response-*     -----------------> LLM response chunks           |
|   atlas:audio-level    -----------------> Microphone level (~30fps)     |
|   atlas:error          -----------------> Error occurred                |
|   atlas:barge-in       -----------------> User interrupted TTS          |
|                                                                         |
+-------------------------------------------------------------------------+
```

### IPC Security

All IPC handlers implement:
- **Input Validation:** Type checking and sanitization
- **Rate Limiting:** Prevents abuse (60 requests/minute)
- **Prototype Pollution Prevention:** Blocks `__proto__`, `constructor`
- **Text Length Limits:** Max 10,000 characters

```typescript
// Example validation
function validateTextInput(text: unknown): ValidationResult {
  if (typeof text !== 'string') {
    return { valid: false, error: 'Text must be a string' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { valid: false, error: 'Text exceeds maximum length' };
  }
  return { valid: true, sanitized: text.trim() };
}
```

---

## State Management

### Main Process State

The main process uses event-driven state management:

```typescript
class VoicePipeline extends EventEmitter {
  private state: VoicePipelineState = 'idle';

  private setState(newState: VoicePipelineState): void {
    const previousState = this.state;
    this.state = newState;
    this.emit('state-change', newState, previousState);
  }
}
```

### Renderer Process State (Zustand)

The renderer uses Zustand for state management:

```typescript
// stores/atlasStore.ts
interface AtlasStore {
  state: VoiceState;
  audioLevel: number;
  transcript: string;
  response: string;
  settings: Settings;

  // Actions
  setState: (state: VoiceState) => void;
  setAudioLevel: (level: number) => void;
  updateSettings: (settings: Partial<Settings>) => void;
}

const useAtlasStore = create<AtlasStore>((set) => ({
  state: 'idle',
  audioLevel: 0,
  transcript: '',
  response: '',
  settings: defaultSettings,

  setState: (state) => set({ state }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  updateSettings: (settings) =>
    set((prev) => ({ settings: { ...prev.settings, ...settings } })),
}));
```

### IPC State Hook

```typescript
// hooks/useAtlasState.ts
function useAtlasState() {
  const store = useAtlasStore();

  useEffect(() => {
    // Subscribe to IPC events
    const unsub = window.atlas.on('atlas:state-change', ({ state }) => {
      store.setState(state);
    });
    return unsub;
  }, []);

  return {
    state: store.state,
    start: () => window.atlas.start(),
    stop: () => window.atlas.stop(),
    triggerWake: () => window.atlas.triggerWake(),
  };
}
```

---

## Memory System

The memory system provides persistent storage and semantic search:

```
+-------------------------------------------------------------------------+
|                          MEMORY ARCHITECTURE                             |
+-------------------------------------------------------------------------+
|                                                                         |
|   +-------------------+                                                 |
|   |  MemoryManager    |  Orchestrates all memory operations            |
|   +--------+----------+                                                 |
|            |                                                            |
|   +--------+--------+--------+--------+                                 |
|   |        |        |        |        |                                 |
|   v        v        v        v        v                                 |
| +------+ +------+ +------+ +------+ +--------+                         |
| |Vector| |Convo | |Fact  | |Context| |Consol- |                        |
| |Store | |Memory| |Store | |Builder| |idator  |                        |
| +------+ +------+ +------+ +------+ +--------+                         |
|   |                                                                     |
|   v                                                                     |
| +------------------+                                                    |
| |     LanceDB      |  Vector database for embeddings                   |
| +------------------+                                                    |
|                                                                         |
+-------------------------------------------------------------------------+
```

### Components

| Component | Purpose |
|-----------|---------|
| MemoryManager | Central orchestrator |
| VectorStore | LanceDB for semantic search |
| ConversationMemory | Recent conversation history |
| FactStore | User facts and preferences |
| ContextBuilder | Assembles context for LLM |
| Consolidator | Summarizes old memories |

### Memory Record Structure

```typescript
interface MemoryRecord {
  id: string;
  vector: Float32Array;        // Embedding
  content: string;             // Original text
  contentType: 'conversation' | 'fact' | 'preference';
  importance: number;          // 0-1 score
  timestamp: number;
  expiresAt: number | null;    // null = permanent
  metadata: {
    topics: string[];
    sentiment: string;
    source: string;
  };
}
```

---

## Security Architecture

### Defense Layers

```
+-------------------------------------------------------------------------+
|                        SECURITY ARCHITECTURE                             |
+-------------------------------------------------------------------------+
|                                                                         |
|   +-------------------------------------------------------------------+ |
|   |                    RENDERER ISOLATION                              | |
|   |  - Sandbox enabled                                                 | |
|   |  - Context isolation                                               | |
|   |  - No Node.js integration                                         | |
|   |  - CSP headers in production                                      | |
|   +-------------------------------------------------------------------+ |
|                                    |                                    |
|                               contextBridge                             |
|                                    |                                    |
|   +-------------------------------------------------------------------+ |
|   |                     IPC SECURITY LAYER                            | |
|   |  - Input validation                                               | |
|   |  - Rate limiting                                                  | |
|   |  - Prototype pollution prevention                                 | |
|   +-------------------------------------------------------------------+ |
|                                    |                                    |
|   +-------------------------------------------------------------------+ |
|   |                    TOOL EXECUTION LAYER                           | |
|   |  - Command whitelisting                                           | |
|   |  - Path validation                                                | |
|   |  - Privilege restrictions                                         | |
|   +-------------------------------------------------------------------+ |
|                                    |                                    |
|   +-------------------------------------------------------------------+ |
|   |                    API KEY MANAGEMENT                             | |
|   |  - Environment variables                                          | |
|   |  - Never exposed to renderer                                      | |
|   |  - Masked in logs                                                 | |
|   +-------------------------------------------------------------------+ |
|                                                                         |
+-------------------------------------------------------------------------+
```

### Key Security Features

1. **Sandbox Mode:** Renderer process runs in a sandbox
2. **Context Isolation:** No shared context between processes
3. **Input Validation:** All IPC inputs validated and sanitized
4. **Rate Limiting:** Prevents abuse of IPC handlers
5. **Command Sandboxing:** Agent terminal commands are restricted
6. **API Key Protection:** Keys never exposed to renderer

---

## Technology Stack

```
+-------------------------------------------------------------------------+
|                          TECHNOLOGY STACK                                |
+-------------------------------------------------------------------------+
|                                                                         |
|   LAYER              TECHNOLOGY              PURPOSE                    |
|   -----              ----------              -------                    |
|                                                                         |
|   Framework          Electron ^28.1.0        Desktop app framework      |
|   UI                 React ^18.2.0           Component-based UI         |
|   Language           TypeScript ^5.3.3       Type safety                |
|   Build              Vite ^5.0.10            Fast bundling              |
|   Test               Vitest ^1.1.0           Unit/integration tests     |
|                                                                         |
|   3D Graphics        Three.js ^0.160.0       WebGL rendering            |
|   React 3D           @react-three/fiber      React renderer for Three   |
|   3D Helpers         @react-three/drei       Useful Three.js utils      |
|                                                                         |
|   Wake Word          Porcupine ^4.0.1        "Hey Atlas" detection      |
|   Audio Capture      PvRecorder ^1.2.8       Microphone streaming       |
|   VAD                @ricky0123/vad-node     Speech boundary detection  |
|   ML Runtime         onnxruntime-node        VAD model inference        |
|                                                                         |
|   STT (Primary)      @deepgram/sdk ^4.11     Cloud transcription        |
|   STT (Fallback)     vosk-koffi ^1.1.1       Offline transcription      |
|                                                                         |
|   LLM (Primary)      Fireworks AI            Fast LLM inference         |
|   LLM (Fallback)     OpenRouter              Multi-model routing        |
|   LLM Client         openai ^6.16.0          OpenAI-compatible API      |
|                                                                         |
|   TTS (Primary)      ElevenLabs              High-quality voice         |
|   TTS (Fallback)     Piper/espeak            Offline synthesis          |
|                                                                         |
|   State              Zustand ^4.4.7          Lightweight state mgmt     |
|   Logging            Winston ^3.11.0         Structured logging         |
|   Config             dotenv ^16.3.1          Environment variables      |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## Design Patterns

### Singleton Pattern

Used for service managers to ensure single instances:

```typescript
let instance: MyManager | null = null;

export function getMyManager(): MyManager {
  if (!instance) {
    instance = new MyManager();
  }
  return instance;
}

export async function shutdownMyManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
```

### Observer Pattern

Event-driven communication using EventEmitter:

```typescript
class VoicePipeline extends EventEmitter {
  // Emit events for state changes
  private setState(state: VoicePipelineState): void {
    this.emit('state-change', state);
  }
}

// Consumers subscribe
pipeline.on('state-change', (state) => {
  updateUI(state);
});
```

### Strategy Pattern

Provider managers use strategy pattern for swappable providers:

```typescript
interface STTProvider {
  transcribe(audio: Buffer): Promise<TranscriptionResult>;
}

class DeepgramProvider implements STTProvider { /* ... */ }
class VoskProvider implements STTProvider { /* ... */ }

class STTManager {
  private provider: STTProvider;

  setProvider(provider: STTProvider): void {
    this.provider = provider;
  }
}
```

### Factory Pattern

IPC handler creation uses factory pattern:

```typescript
function createIPCHandler<T, R>(
  channel: string,
  handler: (args: T) => Promise<R>
): void {
  ipcMain.handle(channel, async (event, args) => {
    try {
      const result = await handler(args);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
```

---

## Performance Architecture

### Optimization Strategies

```
+-------------------------------------------------------------------------+
|                      PERFORMANCE OPTIMIZATIONS                           |
+-------------------------------------------------------------------------+
|                                                                         |
|   STARTUP OPTIMIZATION                                                  |
|   +---------------------------------------------------------------+    |
|   | - Lazy loading of non-critical modules                        |    |
|   | - Connection warmup in background                             |    |
|   | - Deferred initialization of fallback providers               |    |
|   +---------------------------------------------------------------+    |
|                                                                         |
|   RUNTIME OPTIMIZATION                                                  |
|   +---------------------------------------------------------------+    |
|   | - Streaming for all providers (STT, LLM, TTS)                 |    |
|   | - Audio level throttling (~30fps)                             |    |
|   | - Response caching for repeated queries                       |    |
|   | - Adaptive particle count based on GPU                        |    |
|   +---------------------------------------------------------------+    |
|                                                                         |
|   RESILIENCE                                                            |
|   +---------------------------------------------------------------+    |
|   | - Circuit breaker for external services                       |    |
|   | - Automatic fallback to offline providers                     |    |
|   | - Graceful degradation on low performance                     |    |
|   +---------------------------------------------------------------+    |
|                                                                         |
+-------------------------------------------------------------------------+
```

### Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Cold startup | <3s | 2.5s |
| Warm startup | <1s | 0.8s |
| Wake word detection | <200ms | 150ms |
| STT latency | <300ms | 250ms |
| LLM first token | <2s | 1.5s |
| TTS first audio | <500ms | 400ms |
| Total response | <3s | 2.5s |
| Memory usage | <500MB | 350MB |
| Orb framerate | 60fps | 60fps |

---

## Related Documentation

- [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md) - Development setup and guidelines
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [CODEBASE_DIAGRAM.md](./CODEBASE_DIAGRAM.md) - Detailed codebase diagrams
- [T1-CORE-IMPLEMENTATION.md](./T1-CORE-IMPLEMENTATION.md) - Voice + LLM implementation
- [T2-FLOW-IMPLEMENTATION.md](./T2-FLOW-IMPLEMENTATION.md) - Workflows implementation
- [T3-ORB-IMPLEMENTATION.md](./T3-ORB-IMPLEMENTATION.md) - Visualization implementation
- [T4-TOOLS-IMPLEMENTATION.md](./T4-TOOLS-IMPLEMENTATION.md) - Agent tools implementation

---

**Last Updated:** January 15, 2026
