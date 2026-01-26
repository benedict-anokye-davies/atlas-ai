# Atlas IPC Channels Reference

**Version:** 1.0.0
**Last Updated:** 2026-01-15

This document provides detailed documentation for all IPC (Inter-Process Communication) channels available in Atlas Desktop.

## Table of Contents

- [Overview](#overview)
- [Voice Pipeline](#voice-pipeline)
- [Memory Management](#memory-management)
- [Budget and Cost Tracking](#budget-and-cost-tracking)
- [Personality Management](#personality-management)
- [Connectivity](#connectivity)
- [GPU Detection](#gpu-detection)
- [Smart Provider Management](#smart-provider-management)
- [Legacy Voice API](#legacy-voice-api)
- [Legacy Pipeline API](#legacy-pipeline-api)
- [Events API](#events-api)

## Overview

All IPC channels are exposed through the `window.atlas` global object. The API is fully type-safe and returns `IPCResult<T>` objects.

### Base Types

```typescript
/**
 * Standard IPC result wrapper
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Voice pipeline configuration
 */
interface VoicePipelineConfig {
  sttProvider?: 'deepgram' | 'vosk' | 'whisper';
  llmProvider?: 'fireworks' | 'openrouter';
  ttsEnabled?: boolean;
  bargeInEnabled?: boolean;
  systemPrompt?: string;
}
```

---

## Voice Pipeline

Primary API for controlling the full voice interaction pipeline (STT -> LLM -> TTS).

**Namespace:** `window.atlas.atlas`

### atlas.start()

Start the voice pipeline with optional configuration.

```typescript
start(config?: Partial<VoicePipelineConfig>): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `config.sttProvider` | `'deepgram' \| 'vosk' \| 'whisper'` | No | Speech-to-text provider |
| `config.llmProvider` | `'fireworks' \| 'openrouter'` | No | LLM provider |
| `config.ttsEnabled` | `boolean` | No | Enable text-to-speech |
| `config.bargeInEnabled` | `boolean` | No | Allow user interruption |
| `config.systemPrompt` | `string` | No | Custom system prompt |

**Example:**
```typescript
const result = await window.atlas.atlas.start({
  sttProvider: 'deepgram',
  llmProvider: 'fireworks',
  ttsEnabled: true,
  bargeInEnabled: true
});

if (result.success) {
  console.log('Voice pipeline started');
} else {
  console.error('Failed to start:', result.error);
}
```

---

### atlas.stop()

Stop the voice pipeline (preserves state for restart).

```typescript
stop(): Promise<IPCResult>
```

**Example:**
```typescript
await window.atlas.atlas.stop();
```

---

### atlas.shutdown()

Completely shutdown the voice pipeline and release all resources.

```typescript
shutdown(): Promise<IPCResult>
```

**Example:**
```typescript
// Full cleanup on app exit
await window.atlas.atlas.shutdown();
```

---

### atlas.getStatus()

Get current voice pipeline status.

```typescript
getStatus(): Promise<IPCResult<FullVoicePipelineStatus>>
```

**Response Type:**
```typescript
interface FullVoicePipelineStatus {
  state: 'idle' | 'listening' | 'wake_word_detected' | 'recording' | 'processing' | 'speaking' | 'error';
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

**Example:**
```typescript
const status = await window.atlas.atlas.getStatus();
if (status.success) {
  console.log('Current state:', status.data.state);
  console.log('Audio level:', status.data.audioLevel);
}
```

---

### atlas.triggerWake()

Manually trigger wake (push-to-talk mode).

```typescript
triggerWake(): Promise<IPCResult>
```

**Example:**
```typescript
// User clicked the orb or pressed a hotkey
await window.atlas.atlas.triggerWake();
```

---

### atlas.sendText()

Send text directly to the LLM (bypasses speech-to-text).

```typescript
sendText(text: string): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `text` | `string` | Yes | Text to send to LLM (max 10,000 chars) |

**Rate Limit:** 60 requests per minute

**Example:**
```typescript
const result = await window.atlas.atlas.sendText('What is the capital of France?');
if (!result.success) {
  if (result.error?.includes('Rate limit')) {
    // Wait before retrying
  }
}
```

---

### atlas.clearHistory()

Clear conversation history.

```typescript
clearHistory(): Promise<IPCResult>
```

**Example:**
```typescript
// Start fresh conversation
await window.atlas.atlas.clearHistory();
```

---

### atlas.getContext()

Get current conversation context.

```typescript
getContext(): Promise<IPCResult>
```

**Example:**
```typescript
const context = await window.atlas.atlas.getContext();
console.log('Conversation context:', context.data);
```

---

### atlas.getMetrics()

Get interaction metrics.

```typescript
getMetrics(): Promise<IPCResult>
```

**Response includes:**
- Total interactions
- Average response time
- Token usage
- Error rates

---

### atlas.updateConfig()

Update pipeline configuration at runtime.

```typescript
updateConfig(config: Partial<VoicePipelineConfig>): Promise<IPCResult>
```

**Example:**
```typescript
// Disable TTS for quiet mode
await window.atlas.atlas.updateConfig({
  ttsEnabled: false
});
```

---

### atlas.getConfig()

Get current pipeline configuration.

```typescript
getConfig(): Promise<IPCResult<VoicePipelineConfig | null>>
```

---

## Memory Management

APIs for managing conversation memory and context.

### atlas.getConversationHistory()

Get recent conversation messages.

```typescript
getConversationHistory(limit?: number): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `limit` | `number` | No | All | Maximum messages to return |

**Example:**
```typescript
// Get last 10 messages
const history = await window.atlas.atlas.getConversationHistory(10);
if (history.success) {
  history.data.forEach(msg => {
    console.log(`${msg.role}: ${msg.content}`);
  });
}
```

---

### atlas.clearMemory()

Clear all memory and start fresh session.

```typescript
clearMemory(): Promise<IPCResult>
```

**Note:** This clears both conversation history and semantic memory. A new session is automatically started.

---

### atlas.getMemoryStats()

Get memory system statistics.

```typescript
getMemoryStats(): Promise<IPCResult>
```

**Response includes:**
- Total entries
- Entry counts by type
- Memory size
- Session count

---

### atlas.searchMemory()

Search memory entries.

```typescript
searchMemory(query: {
  type?: 'conversation' | 'fact' | 'preference' | 'context';
  tags?: string[];
  minImportance?: number;
  text?: string;
  limit?: number;
}): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `type` | `string` | Filter by entry type |
| `tags` | `string[]` | Filter by tags |
| `minImportance` | `number` | Minimum importance score (0-1) |
| `text` | `string` | Full-text search |
| `limit` | `number` | Maximum results |

**Example:**
```typescript
// Find important facts
const facts = await window.atlas.atlas.searchMemory({
  type: 'fact',
  minImportance: 0.8,
  limit: 10
});
```

---

### atlas.getAllSessions()

Get all conversation sessions.

```typescript
getAllSessions(): Promise<IPCResult>
```

---

## Budget and Cost Tracking

APIs for monitoring and controlling API usage costs.

### atlas.getBudgetStats()

Get current budget statistics.

```typescript
getBudgetStats(): Promise<IPCResult>
```

**Response includes:**
- Daily spending
- Daily budget limit
- Remaining budget
- Usage breakdown by service

---

### atlas.setDailyBudget()

Set daily budget limit.

```typescript
setDailyBudget(budget: number): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `budget` | `number` | Yes | Daily budget in USD (must be >= 0) |

**Example:**
```typescript
// Set $5 daily budget
await window.atlas.atlas.setDailyBudget(5.00);
```

---

## Personality Management

APIs for controlling LLM personality and behavior.

### atlas.getPersonality()

Get current personality settings.

```typescript
getPersonality(): Promise<IPCResult<{
  preset: string;
  traits: PersonalityTraits;
}>>
```

**Response Type:**
```typescript
interface PersonalityTraits {
  friendliness: number;  // 0-1: Reserved to Warm
  formality: number;     // 0-1: Casual to Formal
  humor: number;         // 0-1: Serious to Playful
  curiosity: number;     // 0-1: Direct to Inquisitive
  energy: number;        // 0-1: Calm to Energetic
  patience: number;      // 0-1: Brief to Thorough
}
```

**Example:**
```typescript
const personality = await window.atlas.atlas.getPersonality();
if (personality.success) {
  console.log('Preset:', personality.data.preset);
  console.log('Humor level:', personality.data.traits.humor);
}
```

---

### atlas.setPersonalityPreset()

Set personality preset.

```typescript
setPersonalityPreset(preset: PersonalityPreset): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Options | Description |
|------|------|---------|-------------|
| `preset` | `PersonalityPreset` | `'atlas'`, `'professional'`, `'playful'`, `'minimal'` | Personality preset |

**Preset Descriptions:**
| Preset | Description |
|--------|-------------|
| `atlas` | Default balanced personality |
| `professional` | Formal, concise, business-oriented |
| `playful` | Casual, humorous, energetic |
| `minimal` | Brief, direct, low-energy |

**Example:**
```typescript
// Switch to professional mode for work
await window.atlas.atlas.setPersonalityPreset('professional');
```

---

### atlas.setPersonalityTrait()

Set individual personality trait.

```typescript
setPersonalityTrait(trait: keyof PersonalityTraits, value: number): Promise<IPCResult>
```

**Parameters:**
| Name | Type | Range | Description |
|------|------|-------|-------------|
| `trait` | `string` | - | Trait name |
| `value` | `number` | 0-1 | Trait intensity |

**Example:**
```typescript
// Increase humor
await window.atlas.atlas.setPersonalityTrait('humor', 0.9);

// Decrease formality
await window.atlas.atlas.setPersonalityTrait('formality', 0.2);
```

---

## Connectivity

APIs for monitoring network and service availability.

### atlas.getConnectivity()

Get full connectivity status.

```typescript
getConnectivity(): Promise<IPCResult<{
  status: ConnectivityStatus;
  services: ServiceAvailability;
}>>
```

**Response Types:**
```typescript
interface ConnectivityStatus {
  isOnline: boolean;
  lastCheck: number;
  lastOnline: number | null;
  consecutiveFailures: number;
  latency: number | null;
}

interface ServiceAvailability {
  fireworks: boolean;
  deepgram: boolean;
  elevenlabs: boolean;
  internet: boolean;
}
```

**Example:**
```typescript
const conn = await window.atlas.atlas.getConnectivity();
if (conn.success) {
  if (!conn.data.services.fireworks) {
    console.log('Fireworks API unavailable');
  }
}
```

---

### atlas.isOnline()

Quick online status check.

```typescript
isOnline(): Promise<IPCResult<boolean>>
```

---

### atlas.checkConnectivity()

Force connectivity check.

```typescript
checkConnectivity(): Promise<IPCResult<boolean>>
```

---

### atlas.isServiceAvailable()

Check specific service availability.

```typescript
isServiceAvailable(
  service: 'fireworks' | 'deepgram' | 'elevenlabs' | 'internet'
): Promise<IPCResult<boolean>>
```

---

## GPU Detection

APIs for detecting GPU capabilities and optimizing rendering.

### atlas.setGPUInfo()

Set GPU info from renderer WebGL detection.

```typescript
setGPUInfo(webglInfo: WebGLInfo): Promise<IPCResult<GPUCapabilities>>
```

**Input Type:**
```typescript
interface WebGLInfo {
  vendor: string;
  renderer: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  version?: 1 | 2;
  maxTextureSize?: number;
  maxViewportDims?: [number, number];
  maxRenderbufferSize?: number;
  extensions?: string[];
  antialias?: boolean;
  floatTextures?: boolean;
  instancedArrays?: boolean;
  vertexArrayObjects?: boolean;
}
```

**Response Type:**
```typescript
interface GPUCapabilities {
  gpu: {
    vendor: string;
    renderer: string;
    tier: 'high' | 'medium' | 'low' | 'integrated';
    estimatedVRAM: number;
  };
  config: GPURenderingConfig;
}

interface GPURenderingConfig {
  particleCount: number;
  maxDpr: number;
  enablePostProcessing: boolean;
  enableAntialias: boolean;
  shadowQuality: 0 | 1 | 2 | 3;
  bloomIntensity: number;
  targetFps: number;
  maxAnimations: number;
}
```

---

### atlas.getGPUCapabilities()

Get cached GPU capabilities.

```typescript
getGPUCapabilities(): Promise<IPCResult<GPUCapabilities | null>>
```

---

### atlas.getRecommendedParticles()

Get recommended particle count for current GPU.

```typescript
getRecommendedParticles(): Promise<IPCResult<number>>
```

---

### atlas.getRenderConfig()

Get recommended rendering configuration.

```typescript
getRenderConfig(): Promise<IPCResult<GPURenderingConfig>>
```

---

## Smart Provider Management

APIs for managing STT/TTS/LLM provider selection.

### atlas.getCurrentProviders()

Get currently active providers.

```typescript
getCurrentProviders(): Promise<IPCResult<{
  stt: 'deepgram' | 'vosk' | 'whisper' | null;
  tts: 'elevenlabs' | 'piper' | 'system' | null;
  llm: 'fireworks' | 'openrouter' | 'local' | null;
}>>
```

---

### atlas.forceSTTProvider()

Force a specific STT provider.

```typescript
forceSTTProvider(provider: 'deepgram' | 'vosk' | 'whisper'): Promise<IPCResult>
```

---

### atlas.forceTTSProvider()

Force a specific TTS provider.

```typescript
forceTTSProvider(provider: 'elevenlabs' | 'piper' | 'system'): Promise<IPCResult>
```

---

### atlas.forceLLMProvider()

Force a specific LLM provider.

```typescript
forceLLMProvider(provider: 'fireworks' | 'openrouter' | 'local'): Promise<IPCResult>
```

---

### atlas.reselectProviders()

Re-select all providers based on current conditions.

```typescript
reselectProviders(): Promise<IPCResult<{
  stt: 'deepgram' | 'vosk' | 'whisper' | null;
  tts: 'elevenlabs' | 'piper' | 'system' | null;
  llm: 'fireworks' | 'openrouter' | 'local' | null;
}>>
```

**Use after:** Connectivity changes, user preference changes

---

## Legacy Voice API

**Namespace:** `window.atlas.voice`

**Status:** Deprecated - Use `window.atlas.atlas` instead

Wake word only functionality (no STT/LLM/TTS).

### voice.startWakeWord()

```typescript
startWakeWord(): Promise<{ success: boolean; error?: string }>
```

### voice.stopWakeWord()

```typescript
stopWakeWord(): Promise<{ success: boolean; error?: string }>
```

### voice.pauseWakeWord()

```typescript
pauseWakeWord(): Promise<{ success: boolean; error?: string }>
```

### voice.resumeWakeWord()

```typescript
resumeWakeWord(): Promise<{ success: boolean; error?: string }>
```

### voice.setSensitivity()

```typescript
setSensitivity(sensitivity: number): Promise<{ success: boolean; error?: string }>
```

### voice.getAudioDevices()

```typescript
getAudioDevices(): Promise<Array<{
  index: number;
  name: string;
  isDefault: boolean;
}>>
```

### voice.setAudioDevice()

```typescript
setAudioDevice(deviceIndex: number): Promise<{ success: boolean; error?: string }>
```

---

## Legacy Pipeline API

**Namespace:** `window.atlas.pipeline`

**Status:** Deprecated - Use `window.atlas.atlas` instead

Basic wake word + VAD pipeline (no LLM/TTS).

### pipeline.start()

```typescript
start(): Promise<{ success: boolean; error?: string }>
```

### pipeline.stop()

```typescript
stop(): Promise<{ success: boolean; error?: string }>
```

### pipeline.getStatus()

```typescript
getStatus(): Promise<{
  state: string;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  lastWakeWord?: unknown;
  error?: string;
}>
```

### pipeline.triggerWake()

```typescript
triggerWake(): Promise<{ success: boolean; error?: string }>
```

---

## Events API

Subscribe to real-time events from the main process.

### window.atlas.on()

Subscribe to an event channel.

```typescript
on(channel: string, callback: (...args: unknown[]) => void): () => void
```

**Returns:** Cleanup function to unsubscribe

**Valid Channels:**
```typescript
const validChannels = [
  // Voice pipeline events
  'atlas:state-change',
  'atlas:wake-word',
  'atlas:speech-start',
  'atlas:speech-end',
  'atlas:transcript-interim',
  'atlas:transcript-final',
  'atlas:response-start',
  'atlas:response-chunk',
  'atlas:response-complete',
  'atlas:audio-chunk',
  'atlas:synthesis-complete',
  'atlas:speaking-start',
  'atlas:speaking-end',
  'atlas:barge-in',
  'atlas:audio-level',
  'atlas:error',
  'atlas:started',
  'atlas:stopped',
  'atlas:provider-change',

  // Budget events
  'atlas:budget-update',
  'atlas:budget-warning',
  'atlas:budget-exceeded',

  // System events
  'atlas:connectivity-change',
  'atlas:audio-devices-changed',
  'atlas:warmup-status',
  'atlas:stt-provider-change',
  'atlas:tts-provider-change',
  'atlas:llm-provider-change',
  'atlas:open-settings',
  'atlas:error-notification',

  // Legacy events
  'atlas:status',
  'atlas:transcript',
  'atlas:response',
  'atlas:pipeline-state',
  'atlas:wake-feedback',
  'atlas:speech-segment',
  'atlas:listening-timeout',
  'atlas:processing-timeout',
  'atlas:still-listening',
  'atlas:listening-state',
  'atlas:tts-audio',
];
```

**Example:**
```typescript
// Subscribe to multiple events
const cleanups = [
  window.atlas.on('atlas:state-change', ({ state, previousState }) => {
    console.log(`State: ${previousState} -> ${state}`);
  }),

  window.atlas.on('atlas:transcript-final', (result) => {
    console.log('User said:', result.text);
  }),

  window.atlas.on('atlas:response-chunk', (chunk) => {
    process.stdout.write(chunk.text);
  }),

  window.atlas.on('atlas:error', ({ type, message }) => {
    console.error(`Error in ${type}: ${message}`);
  }),
];

// Cleanup all subscriptions
function cleanup() {
  cleanups.forEach(fn => fn());
}
```

---

## Security Considerations

### Input Validation

All IPC handlers validate input to prevent:
- Prototype pollution attacks
- Injection attacks
- Oversized payloads

### Rate Limiting

The `atlas:send-text` channel is rate-limited to 60 requests per minute.

### Sensitive Data

- API keys are never transmitted over IPC
- Clipboard content is scanned for sensitive patterns
- File operations block access to system directories

---

## Error Handling

All methods return `IPCResult` with error information:

```typescript
const result = await window.atlas.atlas.sendText('Hello');

if (!result.success) {
  switch (true) {
    case result.error?.includes('Rate limit'):
      // Wait and retry
      break;
    case result.error?.includes('Pipeline not initialized'):
      // Start pipeline first
      await window.atlas.atlas.start();
      break;
    case result.error?.includes('Text cannot be empty'):
      // Validation error
      break;
    default:
      console.error('Unknown error:', result.error);
  }
}
```

---

## Related Documentation

- [Main API Reference](../API.md)
- [Agent Tools Reference](./tools.md)
