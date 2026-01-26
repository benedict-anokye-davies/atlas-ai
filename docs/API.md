# Atlas Desktop API Reference

**Version:** 1.0.0
**Last Updated:** 2026-01-15

This document provides comprehensive API documentation for Atlas Desktop, a voice-first AI assistant built with Electron, React, and TypeScript.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [IPC Communication](#ipc-communication)
- [Agent Tools](#agent-tools)
- [Configuration](#configuration)
- [Events](#events)
- [Type Definitions](#type-definitions)

## Overview

Atlas Desktop follows an Electron architecture with clear separation between the main process (Node.js) and renderer process (React). Communication between processes occurs through IPC (Inter-Process Communication) channels.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Main Process** | Node.js process handling native operations, voice pipeline, LLM integration |
| **Renderer Process** | React application for UI rendering and user interaction |
| **IPC Channels** | Type-safe communication channels between processes |
| **Agent Tools** | Executable capabilities exposed to the LLM for task automation |
| **Voice Pipeline** | Wake word detection -> STT -> LLM -> TTS flow |

## Architecture

```
+------------------+       IPC        +------------------+
|  Renderer (UI)   | <--------------> |   Main Process   |
+------------------+                  +------------------+
        |                                     |
        v                                     v
+------------------+                  +------------------+
| React + R3F      |                  | Voice Pipeline   |
| Zustand Store    |                  | Agent Tools      |
| useAtlasState    |                  | Memory System    |
+------------------+                  +------------------+
```

### Process Communication Flow

1. Renderer calls `window.atlas.atlas.*` methods
2. Methods invoke IPC handlers via `ipcRenderer.invoke()`
3. Main process executes operations
4. Results returned to renderer as `IPCResult<T>`

## IPC Communication

Atlas exposes a type-safe API through the `window.atlas` global object. All IPC methods return `Promise<IPCResult<T>>`.

### IPCResult Interface

```typescript
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
```

### API Categories

| Category | Namespace | Description |
|----------|-----------|-------------|
| [Voice Pipeline](./api/ipc-channels.md#voice-pipeline) | `window.atlas.atlas.*` | Full voice interaction control |
| [Memory](./api/ipc-channels.md#memory) | `window.atlas.atlas.*` | Conversation and memory management |
| [Personality](./api/ipc-channels.md#personality) | `window.atlas.atlas.*` | LLM personality configuration |
| [Connectivity](./api/ipc-channels.md#connectivity) | `window.atlas.atlas.*` | Network and service status |
| [GPU](./api/ipc-channels.md#gpu) | `window.atlas.atlas.*` | GPU detection and rendering config |
| [Providers](./api/ipc-channels.md#providers) | `window.atlas.atlas.*` | Smart provider management |
| [Legacy Voice](./api/ipc-channels.md#legacy-voice) | `window.atlas.voice.*` | Wake word only (deprecated) |
| [Legacy Pipeline](./api/ipc-channels.md#legacy-pipeline) | `window.atlas.pipeline.*` | Basic pipeline (deprecated) |

**Full IPC documentation:** [docs/api/ipc-channels.md](./api/ipc-channels.md)

### Quick Examples

```typescript
// Start the voice pipeline
const result = await window.atlas.atlas.start();
if (result.success) {
  console.log('Pipeline started');
}

// Send text directly (bypass voice input)
await window.atlas.atlas.sendText('What is the weather today?');

// Get current status
const status = await window.atlas.atlas.getStatus();
console.log('State:', status.data?.state);

// Listen for events
const cleanup = window.atlas.on('atlas:response-chunk', (chunk) => {
  console.log('LLM says:', chunk.text);
});

// Stop listening
cleanup();
```

## Agent Tools

Agent tools are capabilities exposed to the LLM for executing tasks on behalf of the user. Tools are organized by category and follow a standard interface.

### Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| [Filesystem](./api/tools.md#filesystem-tools) | 9 | File read/write/search operations |
| [Terminal](./api/tools.md#terminal-tools) | 5 | Command execution |
| [Browser](./api/tools.md#browser-tools) | 6 | Playwright automation |
| [Screenshot](./api/tools.md#screenshot-tools) | 3 | Screen capture |
| [Clipboard](./api/tools.md#clipboard-tools) | 6 | Clipboard operations |
| [Search](./api/tools.md#search-tools) | 2 | Web search and fetch |
| [Git](./api/tools.md#git-tools) | 12 | Version control |
| [System](./api/tools.md#system-tools) | 10 | OS control (volume, brightness, timers) |

**Full tools documentation:** [docs/api/tools.md](./api/tools.md)

### Tool Interface

```typescript
interface AgentTool {
  /** Unique tool identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON schema for tool parameters */
  parameters: Record<string, unknown>;
  /** Tool execution function */
  execute: (params: Record<string, unknown>) => Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### Using Tools Programmatically

```typescript
import { getToolByName, getAllTools } from './agent/tools';

// Get all available tools
const tools = getAllTools();
console.log(`${tools.length} tools available`);

// Execute a specific tool
const readFile = getToolByName('read_file');
if (readFile) {
  const result = await readFile.execute({
    path: './README.md'
  });
  if (result.success) {
    console.log(result.data.content);
  }
}
```

## Configuration

Atlas configuration is managed through environment variables and secure keychain storage.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORCUPINE_API_KEY` | Yes | - | Picovoice wake word detection |
| `DEEPGRAM_API_KEY` | Yes | - | Speech-to-text |
| `ELEVENLABS_API_KEY` | Yes | - | Text-to-speech |
| `FIREWORKS_API_KEY` | Yes | - | Primary LLM (DeepSeek V3.1) |
| `OPENROUTER_API_KEY` | Yes | - | Fallback LLM |
| `PERPLEXITY_API_KEY` | No | - | Web search enhancement |

### Settings Variables

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `ELEVENLABS_VOICE_ID` | `onyx` | - | Voice ID for TTS |
| `FIREWORKS_MODEL` | `accounts/fireworks/models/deepseek-r1` | - | Primary LLM model |
| `OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | - | Fallback LLM model |
| `NODE_ENV` | `development` | development/production/test | Environment mode |
| `LOG_LEVEL` | `debug` | debug/info/warn/error | Logging verbosity |
| `LOG_DIR` | `~/.atlas/logs` | - | Log file directory |
| `AUDIO_SAMPLE_RATE` | `16000` | 8000-48000 | Audio sample rate (Hz) |
| `AUDIO_CHANNELS` | `1` | 1-2 | Audio channel count |
| `WAKE_WORD_SENSITIVITY` | `0.5` | 0-1 | Wake word detection sensitivity |
| `VAD_THRESHOLD` | `0.5` | 0-1 | Voice activity detection threshold |
| `VAD_SILENCE_DURATION` | `1500` | ms | Silence duration to end speech |
| `USER_NAME` | `User` | - | User's display name |

### Configuration API

```typescript
import { getConfig, getConfigValue, isConfigValid } from './config';

// Get full config
const config = getConfig();

// Get specific value
const logLevel = getConfigValue('logLevel');

// Check if valid (all required keys present)
if (isConfigValid()) {
  // All API keys are configured
}

// Secure key storage (recommended)
import { getSecureApiKey, setSecureApiKey } from './config';

// Get API key from keychain
const apiKey = await getSecureApiKey('deepgramApiKey');

// Store API key securely
await setSecureApiKey('deepgramApiKey', 'your-api-key');
```

### AtlasConfig Interface

```typescript
interface AtlasConfig {
  // API Keys
  porcupineApiKey: string;
  deepgramApiKey: string;
  elevenlabsApiKey: string;
  fireworksApiKey: string;
  openrouterApiKey: string;
  perplexityApiKey?: string;

  // ElevenLabs settings
  elevenlabsVoiceId: string;

  // LLM settings
  fireworksModel: string;
  openrouterModel: string;

  // Environment
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logDir: string;

  // Audio settings
  audioSampleRate: number;
  audioChannels: number;

  // Voice settings
  wakeWordSensitivity: number;
  vadThreshold: number;
  vadSilenceDuration: number;

  // User settings
  userName: string;
}
```

## Events

Atlas uses a pub/sub pattern for real-time events from the main process to renderer.

### Subscribing to Events

```typescript
// Subscribe
const cleanup = window.atlas.on('atlas:response-chunk', (chunk) => {
  console.log('Received chunk:', chunk.text);
});

// Unsubscribe when done
cleanup();
```

### Voice Pipeline Events

| Event | Payload | Description |
|-------|---------|-------------|
| `atlas:state-change` | `{ state, previousState }` | Pipeline state changed |
| `atlas:wake-word` | `WakeWordEvent` | Wake word detected |
| `atlas:speech-start` | - | User started speaking |
| `atlas:speech-end` | `{ duration }` | User stopped speaking |
| `atlas:transcript-interim` | `{ text }` | Interim transcription |
| `atlas:transcript-final` | `TranscriptionResult` | Final transcription |
| `atlas:response-start` | - | LLM response starting |
| `atlas:response-chunk` | `LLMStreamChunk` | LLM streaming chunk |
| `atlas:response-complete` | `LLMResponse` | LLM response finished |
| `atlas:audio-chunk` | `{ data, format, isFinal, duration }` | TTS audio chunk (base64) |
| `atlas:synthesis-complete` | `TTSSynthesisResult` | TTS synthesis done |
| `atlas:speaking-start` | - | Atlas started speaking |
| `atlas:speaking-end` | - | Atlas stopped speaking |
| `atlas:barge-in` | - | User interrupted Atlas |
| `atlas:audio-level` | `{ level }` | Audio input level (0-1) |
| `atlas:error` | `{ type, message }` | Error occurred |
| `atlas:started` | - | Pipeline started |
| `atlas:stopped` | - | Pipeline stopped |
| `atlas:provider-change` | `{ type, provider }` | Provider switched |

### System Events

| Event | Payload | Description |
|-------|---------|-------------|
| `atlas:connectivity-change` | `{ isOnline, services }` | Network status changed |
| `atlas:budget-warning` | `{ spent, limit, percentage }` | Approaching budget limit |
| `atlas:budget-exceeded` | `{ spent, limit }` | Budget exceeded |
| `atlas:audio-devices-changed` | `{ devices }` | Audio devices changed |
| `atlas:warmup-status` | `{ service, ready }` | Service warmup status |

## Type Definitions

All TypeScript types are defined in `src/shared/types/`. Key types:

### Voice Types (`voice.ts`)

```typescript
type VoicePipelineState =
  | 'idle'
  | 'listening'
  | 'wake_word_detected'
  | 'recording'
  | 'processing'
  | 'speaking'
  | 'error';

interface FullVoicePipelineStatus {
  state: VoicePipelineState;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  sttProvider: string | null;
  llmProvider: string | null;
  isTTSSpeaking: boolean;
  currentTranscript: string;
  currentResponse: string;
}
```

### LLM Types (`llm.ts`)

```typescript
interface LLMStreamChunk {
  text: string;
  done: boolean;
  tokenCount?: number;
}

interface LLMResponse {
  text: string;
  model: string;
  tokenCount: {
    prompt: number;
    completion: number;
    total: number;
  };
  latency: number;
}
```

### STT Types (`stt.ts`)

```typescript
interface TranscriptionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  language?: string;
  duration?: number;
}
```

### TTS Types (`tts.ts`)

```typescript
interface TTSAudioChunk {
  data: Buffer;
  format: 'mp3' | 'pcm' | 'wav';
  isFinal: boolean;
  duration?: number;
}

interface TTSSynthesisResult {
  audio: Buffer;
  format: 'mp3' | 'pcm' | 'wav';
  duration: number;
  characterCount: number;
}
```

### Personality Types (`personality.ts`)

```typescript
type PersonalityPreset = 'atlas' | 'professional' | 'playful' | 'minimal';

interface PersonalityTraits {
  friendliness: number;  // 0-1
  formality: number;     // 0-1
  humor: number;         // 0-1
  curiosity: number;     // 0-1
  energy: number;        // 0-1
  patience: number;      // 0-1
}
```

## Related Documentation

- [IPC Channels Reference](./api/ipc-channels.md)
- [Agent Tools Reference](./api/tools.md)
- [Project Overview (CLAUDE.md)](../CLAUDE.md)
- [Implementation Guides](./T1-CORE-IMPLEMENTATION.md)

---

**Note:** This documentation is auto-generated from TypeScript source files. Keep it in sync with code changes.
