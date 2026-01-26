# NovaVoice - Ultra-Low-Latency Voice Engine

> ️ Unified STT + TTS + VAD for sub-500ms voice-to-voice latency

## Overview

NovaVoice is a high-performance voice processing engine that combines:

- **Whisper Turbo STT** - 216x real-time factor, <100ms first token
- **Kokoro TTS** - 40-70ms time-to-first-byte, 82M params
- **Silero VAD** - 87.7% true positive rate, 10-20ms detection

Built for real-time voice assistants where latency matters.

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| End-to-end latency | <500ms | 400-600ms |
| STT first token | <100ms | 50-100ms |
| TTS first byte | <100ms | 40-70ms |
| VAD detection | <50ms | 10-20ms |

## Quick Start

```typescript
import { initializeNovaVoice } from './nova-voice';

// Initialize with balanced preset
const voice = await initializeNovaVoice({
  targetLatencyMs: 500,
});

// Start listening for speech
await voice.startListening();

// Handle transcriptions
voice.on('stt-final', async (transcription) => {
  console.log('User:', transcription.final);
  
  // Generate response with your LLM
  const response = await yourLLM.generate(transcription.final);
  
  // Speak response
  await voice.speak(response);
});

// Process audio from microphone
microphoneStream.on('data', (audioChunk) => {
  voice.processAudioInput({
    data: audioChunk,
    timestamp: Date.now(),
    duration: 20, // ms
    format: { sampleRate: 16000, channels: 1, bitDepth: 16, encoding: 'pcm' },
  });
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NovaVoice Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐         │
│  │  Audio  │──▶│   VAD   │──▶│   STT   │──▶│  Text   │         │
│  │  Input  │   │ Silero  │   │ Whisper │   │ Output  │         │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘         │
│       │             │                             │              │
│       │        Speech/Silence                     │              │
│       │        Detection                          ▼              │
│       │                                    ┌─────────────┐       │
│       │                                    │    LLM      │       │
│       │                                    │ (External)  │       │
│       │                                    └─────────────┘       │
│       │                                           │              │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐         │              │
│  │  Audio  │◀──│  Jitter │◀──│   TTS   │◀────────┘              │
│  │ Output  │   │ Buffer  │   │ Kokoro  │                        │
│  └─────────┘   └─────────┘   └─────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Presets

### Ultra-Low Latency (400-600ms)
```typescript
import { initializeNovaVoice, ULTRA_LOW_LATENCY_PRESET } from './nova-voice';

const voice = await initializeNovaVoice(ULTRA_LOW_LATENCY_PRESET);
```

### Balanced (500-700ms)
```typescript
import { initializeNovaVoice, BALANCED_PRESET } from './nova-voice';

const voice = await initializeNovaVoice(BALANCED_PRESET);
```

### High Quality (700-1000ms)
```typescript
import { initializeNovaVoice, HIGH_QUALITY_PRESET } from './nova-voice';

const voice = await initializeNovaVoice(HIGH_QUALITY_PRESET);
```

### Edge Device (2-5s, minimal resources)
```typescript
import { initializeNovaVoice, EDGE_DEVICE_PRESET } from './nova-voice';

const voice = await initializeNovaVoice(EDGE_DEVICE_PRESET);
```

## Components

### STT Engine (Whisper Turbo)

| Model | Speed | Size | Accuracy |
|-------|-------|------|----------|
| `large-v3-turbo` | 5.4x | 1.6GB | Near best |
| `distil-large-v3` | 6.3x | 756MB | High (English) |
| `medium` | 2x | 1.5GB | High |
| `small` | 6x | 466MB | Medium |
| `base` | 16x | 142MB | Medium-low |
| `tiny` | 32x | 75MB | Low |

### TTS Engine (Kokoro)

| Voice | Language | Gender | Avg TTFB |
|-------|----------|--------|----------|
| `kokoro-af` | en-US | Female | 50ms |
| `kokoro-am` | en-US | Male | 50ms |
| `kokoro-bf` | en-GB | Female | 50ms |
| `kokoro-bm` | en-GB | Male | 50ms |

**Fallback voices (Piper):**
| Voice | Language | Gender | Avg TTFB |
|-------|----------|--------|----------|
| `piper-en-us-amy-medium` | en-US | Female | 80ms |
| `piper-en-us-ryan-high` | en-US | Male | 100ms |

### VAD Engine (Silero)

- **True Positive Rate**: 87.7% @ 5% FPR
- **Detection Latency**: 10-20ms
- **CPU Usage**: 0.43%
- **RTF**: 0.004

## Events

```typescript
// Pipeline state
voice.on('state-change', (state, prevState) => { });

// VAD events
voice.on('vad-speech-start', () => { });
voice.on('vad-speech-end', () => { });

// STT events
voice.on('stt-partial', (text) => { });
voice.on('stt-final', (transcription) => { });

// TTS events
voice.on('tts-start', (text, voiceId) => { });
voice.on('tts-chunk', (audioChunk) => { });
voice.on('tts-complete', (result) => { });

// Turn management
voice.on('turn-start', (isUser) => { });
voice.on('turn-end', (isUser) => { });
voice.on('user-interrupt', () => { });

// Latency tracking
voice.on('latency-metrics', (metrics) => {
  console.log('End-to-end:', metrics.endToEnd, 'ms');
  console.log('STT TTFT:', metrics.sttTTFT, 'ms');
  console.log('TTS TTFB:', metrics.ttsTTFB, 'ms');
});
```

## Latency Optimization Tips

### 1. Use Streaming Mode (Required)
```typescript
const voice = await initializeNovaVoice({
  mode: ProcessingMode.STREAMING,
  stt: { streaming: true },
  tts: { useStreaming: true },
});
```

### 2. Enable Speculative Execution
```typescript
const voice = await initializeNovaVoice({
  speculativeExecution: true,  // Pre-warm models
  parallelProcessing: true,     // Overlap operations
});
```

### 3. Use GPU Acceleration
```typescript
const voice = await initializeNovaVoice({
  stt: { useGPU: true, gpuDevice: 0 },
  tts: { useGPU: true, gpuDevice: 0 },
});
```

### 4. Tune VAD Threshold
```typescript
const voice = await initializeNovaVoice({
  vad: {
    silenceThresholdMs: 400,  // Shorter = faster response
    speechThreshold: 0.5,     // Balance false positives
  },
});
```

### 5. Optimize Audio Buffering
```typescript
const voice = await initializeNovaVoice({
  audioBuffer: {
    bufferSizeMs: 100,        // Optimal for STT
    useLockFreeBuffer: true,  // Reduce sync overhead
  },
  tts: {
    preBufferMs: 50,          // Minimal pre-buffer
    chunkSizeMs: 30,          // Smaller chunks = faster start
  },
});
```

## Requirements

### Hardware
- **Minimum**: 8GB RAM, CPU only (2-5s latency)
- **Recommended**: 16GB RAM, RTX 4070 (500ms latency)
- **Optimal**: 32GB RAM, RTX 5090 (<400ms latency)

### Software
```bash
# Install Python dependencies
pip install faster-whisper torch edge-tts

# Optional: Kokoro for best TTS performance
pip install kokoro

# Optional: Piper for fast local TTS
pip install piper-tts
```

## Comparison with Alternatives

| Feature | NovaVoice | Deepgram+ElevenLabs | GPT-4o Voice |
|---------|-----------|---------------------|--------------|
| **Latency** | 400-600ms | 500-800ms | 232-320ms |
| **Cost** | Free | $$$ | $$$$ |
| **Offline** | [DONE] | [MISSING] | [MISSING] |
| **Voice Clone** | [DONE] (future) | [DONE] | [MISSING] |
| **Privacy** | Full control | Cloud | Cloud |
| **Languages** | 99+ | 30+ | 50+ |

## API Reference

### NovaVoice Class

```typescript
class NovaVoice {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // State
  getState(): PipelineState;
  getConfig(): PipelineConfig;
  updateConfig(config: Partial<PipelineConfig>): void;
  
  // Listening
  startListening(): Promise<void>;
  stopListening(): void;
  isListening(): boolean;
  processAudioInput(chunk: AudioChunk): Promise<void>;
  
  // Transcription
  transcribe(audio: Buffer | AudioChunk[]): Promise<StreamingTranscription>;
  transcribeStream(audioStream: AsyncIterable<AudioChunk>): AsyncIterable<StreamingTranscription>;
  
  // Speech
  speak(text: string, options?: Partial<TTSSynthesisOptions>): Promise<TTSSynthesisResult>;
  speakStream(text: string, options?: Partial<TTSSynthesisOptions>): AsyncIterable<AudioChunk>;
  
  // Voice
  getVoices(): Voice[];
  setVoice(voiceId: string): void;
  getCurrentVoice(): Voice | null;
  
  // Playback
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;
  
  // Metrics
  getLatencyMetrics(): LatencyMetrics | null;
  getAverageLatency(): number;
  getLatencyPercentiles(): { p50: number; p95: number; p99: number };
}
```

## Troubleshooting

### "STT engine not initialized"
```bash
# Check faster-whisper installation
python -c "from faster_whisper import WhisperModel; print('OK')"

# Install if missing
pip install faster-whisper
```

### "TTS timeout"
```bash
# Check edge-tts (fallback)
edge-tts --text "test" --write-media test.mp3

# Install if missing
pip install edge-tts
```

### High latency
1. Enable GPU: `useGPU: true`
2. Use smaller model: `model: 'small'`
3. Reduce buffer sizes
4. Check CPU/GPU utilization

### Audio quality issues
1. Check input sample rate (must be 16kHz)
2. Verify mono channel
3. Check VAD threshold

---

Built with ❤️ for Nova Desktop
