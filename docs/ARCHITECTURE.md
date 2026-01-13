# Nova Desktop Architecture

This document describes the architecture of Nova Desktop, a voice-first AI assistant.

## System Overview

Nova Desktop is built on Electron with a clear separation between the main process (Node.js) and renderer process (React). The main process handles all voice processing, API integrations, and system interactions.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nova Desktop                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Renderer Process                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │   React UI  │  │  State Mgmt │  │  Event Handlers │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │ IPC                             │
│  ┌────────────────────────────┴────────────────────────────┐   │
│  │                    Main Process                          │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │              Voice Pipeline                      │    │   │
│  │  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐   │    │   │
│  │  │  │Wake │→ │ VAD │→ │ STT │→ │ LLM │→ │ TTS │   │    │   │
│  │  │  │Word │  │     │  │     │  │     │  │     │   │    │   │
│  │  │  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘   │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Voice Pipeline (`src/main/voice/voice-pipeline.ts`)

The central orchestrator that connects all voice components:

```typescript
class VoicePipeline extends EventEmitter {
  // Components
  private wakeWord: WakeWordDetector;
  private vad: VADProcessor;
  private sttManager: STTManager;
  private llmManager: LLMManager;
  private ttsManager: TTSManager;
  
  // State machine
  private state: VoicePipelineState;
}
```

**States:**
- `idle` - Waiting for wake word
- `listening` - Wake word detected, capturing speech
- `processing` - Transcribing and generating response
- `speaking` - Playing TTS response

### 2. Wake Word Detection (`src/main/voice/wake-word.ts`)

Uses Picovoice Porcupine for always-on wake word detection:

```typescript
class WakeWordDetector extends EventEmitter {
  // Porcupine instance
  private porcupine: Porcupine;
  private recorder: PvRecorder;
  
  // Events: 'detected', 'error'
}
```

### 3. Voice Activity Detection (`src/main/voice/vad.ts`)

Silero VAD for detecting speech boundaries:

```typescript
class VADProcessor extends EventEmitter {
  // VAD model
  private vad: MicVAD;
  
  // Events: 'speechStart', 'speechEnd', 'segment'
}
```

### 4. Audio Pipeline (`src/main/voice/pipeline.ts`)

Manages audio capture and routing:

```typescript
class AudioPipeline extends EventEmitter {
  // Audio components
  private inputStream: AudioStream;
  private outputStream: AudioStream;
  
  // Events: 'audio', 'error'
}
```

## Provider Architecture

All service providers follow a common pattern with primary/fallback support:

```
┌─────────────────────────────────────────────────────────────┐
│                      Manager                                 │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │ Circuit Breaker │     │      Provider Interface      │   │
│  │                 │     │  ┌─────────┐  ┌─────────┐   │   │
│  │  - Failure cnt  │────▶│  │ Primary │  │Fallback │   │   │
│  │  - State        │     │  │Provider │  │Provider │   │   │
│  │  - Timeout      │     │  └─────────┘  └─────────┘   │   │
│  └─────────────────┘     └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### STT Providers (`src/main/stt/`)

```
STTManager
├── DeepgramSTT (primary)     - Cloud streaming STT
└── VoskSTT (fallback)        - Local offline STT
```

**Interface:**
```typescript
interface STTProvider {
  name: string;
  status: STTStatus;
  
  transcribe(audio: Buffer): Promise<TranscriptionResult>;
  startStreaming(): Promise<void>;
  stopStreaming(): Promise<void>;
  sendAudio(chunk: Buffer): void;
  
  on(event: 'transcript', cb: (text: string, isFinal: boolean) => void): void;
}
```

### LLM Providers (`src/main/llm/`)

```
LLMManager
├── FireworksLLM (primary)    - Fast inference API
└── OpenRouterLLM (fallback)  - Multi-model routing
```

**Interface:**
```typescript
interface LLMProvider {
  name: string;
  status: LLMStatus;
  
  generate(prompt: string, options?: GenerateOptions): Promise<LLMResponse>;
  generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<LLMChunk>;
  
  on(event: 'token', cb: (token: string) => void): void;
}
```

### TTS Providers (`src/main/tts/`)

```
TTSManager
├── ElevenLabsTTS (primary)   - High-quality cloud TTS
└── OfflineTTS (fallback)     - Piper/espeak local TTS
```

**Interface:**
```typescript
interface TTSProvider {
  name: string;
  status: TTSStatus;
  
  synthesize(text: string): Promise<TTSSynthesisResult>;
  speak(text: string, priority?: number): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  
  on(event: 'audio', cb: (chunk: TTSAudioChunk) => void): void;
}
```

## Circuit Breaker Pattern

Automatic failover with recovery:

```typescript
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open';
  private failureCount: number;
  private lastFailure: number;
  
  // Configuration
  private failureThreshold: number = 3;
  private timeout: number = 60000; // 1 minute
  
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
}
```

## IPC Communication (`src/main/ipc/`)

Secure communication between main and renderer:

```
Renderer                          Main
   │                               │
   │  invoke('voice:start')        │
   │──────────────────────────────▶│
   │                               │
   │  result                       │
   │◀──────────────────────────────│
   │                               │
   │  on('voice:state')            │
   │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ (events)
   │                               │
```

**Channels:**
- `voice:start` - Start voice pipeline
- `voice:stop` - Stop voice pipeline
- `voice:getState` - Get current state
- `voice:state` - State change events
- `voice:transcript` - Transcript events
- `voice:response` - Response events

## Data Flow

### Speech Input Flow

```
Microphone
    │
    ▼
┌─────────────────┐
│  Audio Buffer   │
│  (16kHz, mono)  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Wake   │ │  VAD  │
│Word   │ │       │
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
┌─────────────────┐
│   STT Manager   │
│  (Deepgram or   │
│      Vosk)      │
└────────┬────────┘
         │
         ▼
    Transcript
```

### Response Output Flow

```
Transcript
    │
    ▼
┌─────────────────┐
│   LLM Manager   │
│  (Fireworks or  │
│   OpenRouter)   │
└────────┬────────┘
         │
         ▼
   Response Text
         │
         ▼
┌─────────────────┐
│   TTS Manager   │
│  (ElevenLabs or │
│     Piper)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Audio Output   │
│    (Speaker)    │
└─────────────────┘
```

## Configuration System (`src/main/config/`)

Hierarchical configuration with validation:

```typescript
// Priority: CLI args > Environment > .env file > defaults
const config = {
  // Required
  porcupineApiKey: process.env.PORCUPINE_API_KEY,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  
  // Optional
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Derived
  isProduction: process.env.NODE_ENV === 'production',
};
```

## Error Handling (`src/main/utils/errors.ts`)

Typed error hierarchy:

```typescript
class NovaError extends Error {
  code: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

class ProviderError extends NovaError { /* ... */ }
class NetworkError extends NovaError { /* ... */ }
class ConfigurationError extends NovaError { /* ... */ }
class AudioError extends NovaError { /* ... */ }
```

## Logging System (`src/main/utils/logger.ts`)

Structured logging with levels:

```typescript
const logger = createModuleLogger('VoicePipeline');

logger.debug('Processing audio', { bytes: chunk.length });
logger.info('Wake word detected');
logger.warn('Fallback activated', { reason: 'timeout' });
logger.error('Provider failed', { error, provider: 'deepgram' });
```

## Type System (`src/shared/types/`)

Shared types between main and renderer:

```
src/shared/types/
├── config.ts    # Configuration types
├── llm.ts       # LLM provider types
├── stt.ts       # STT provider types
├── tts.ts       # TTS provider types
├── voice.ts     # Voice pipeline types
└── index.ts     # Re-exports
```

## Testing Strategy

```
tests/
├── unit/
│   ├── stt.test.ts         # STT provider tests
│   ├── llm.test.ts         # LLM provider tests
│   ├── tts.test.ts         # TTS provider tests
│   └── ...
├── integration/
│   ├── pipeline.test.ts    # Voice pipeline tests
│   ├── ipc.test.ts         # IPC handler tests
│   └── ...
└── e2e/
    └── ...                  # End-to-end tests
```

## Security Considerations

1. **API Key Storage** - Keys stored in `.env`, never committed
2. **IPC Validation** - All IPC channels validated in preload
3. **Context Isolation** - Renderer has no direct Node.js access
4. **Content Security** - CSP headers in production

## Performance Optimizations

1. **Streaming** - All providers use streaming where possible
2. **Caching** - LLM responses cached for repeated queries
3. **Lazy Loading** - Providers initialized on first use
4. **Circuit Breaker** - Prevents cascade failures
5. **Audio Buffering** - Efficient ring buffer for audio data
