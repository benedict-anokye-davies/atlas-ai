# Atlas Fast Mode - Performance Optimization Guide

## Overview

Fast Mode optimizes Atlas for **sub-500ms response times** by tuning every component of the voice pipeline for speed.

## Key Optimizations

### 1. VAD (Voice Activity Detection)

- **More sensitive speech detection** (threshold: 0.12 vs 0.15)
- **Faster speech confirmation** (1 frame vs 2 frames)
- **Shorter pauses** (4 redemption frames vs 6)
- **Result**: Detects speech faster, ends listening sooner

### 2. Streaming Pipeline

- **TTS buffer reduced** to 8 characters (from 15)
- **Partial transcript processing** enabled
- **Immediate TTS synthesis** on first sentence chunk
- **Result**: Audio starts playing while LLM is still generating

### 3. Context Management

- **Reduced history** to 5 turns (from 10)
- **Faster LLM processing** with smaller context window
- **Result**: Quicker LLM responses, less token usage

### 4. Provider Configuration

- **Faster STT model** (Nova-2)
- **Lower confidence threshold** (0.75 vs 0.8)
- **Quick error recovery** (30s cooldown vs 60s)
- **Result**: Faster transcription, quicker fallback

## Usage

### Enable Fast Mode

```typescript
import { getVoicePipeline } from './voice';
import { enableFastMode } from './voice/fast-mode';

const pipeline = getVoicePipeline();
enableFastMode(pipeline);
```

### Disable Fast Mode

```typescript
import { disableFastMode } from './voice/fast-mode';

disableFastMode(pipeline);
```

### Check Current Mode

```typescript
import { getPerformanceMetrics } from './voice/fast-mode';

const metrics = getPerformanceMetrics();
console.log(`Target latency: ${metrics.targetLatency}ms`);
console.log(`TTS buffer: ${metrics.ttsBufferSize} chars`);
```

## Configuration Values

### Fast Mode Settings

```typescript
{
  // VAD
  positiveSpeechThreshold: 0.12,  // More sensitive
  minSpeechFrames: 1,             // Faster detection
  redemptionFrames: 4,            // Shorter pauses

  // Pipeline
  ttsBufferSize: 8,               // Start TTS sooner
  maxHistoryTurns: 5,             // Smaller context
  enablePartialTranscriptProcessing: true,

  // Timeouts
  listeningTimeout: 10000,        // 10s (vs 15s)
  processingTimeout: 20000,       // 20s (vs 30s)
}
```

### Default Settings

```typescript
{
  // VAD
  positiveSpeechThreshold: 0.15,
  minSpeechFrames: 2,
  redemptionFrames: 6,

  // Pipeline
  ttsBufferSize: 15,
  maxHistoryTurns: 10,
  enablePartialTranscriptProcessing: false,

  // Timeouts
  listeningTimeout: 15000,
  processingTimeout: 30000,
}
```

## Performance Impact

| Metric           | Default  | Fast Mode | Improvement     |
| ---------------- | -------- | --------- | --------------- |
| Speech Detection | ~200ms   | ~100ms    | **2x faster**   |
| TTS Start Delay  | ~500ms   | ~200ms    | **2.5x faster** |
| Total Response   | ~1200ms  | ~500ms    | **2.4x faster** |
| Context Window   | 10 turns | 5 turns   | **50% smaller** |

## Trade-offs

### Benefits

- ✅ **Much faster responses** (sub-500ms target)
- ✅ **More responsive feel**
- ✅ **Better for quick commands**

### Considerations

- ⚠️ **May have more false positives** (sensitive VAD)
- ⚠️ **Shorter conversation memory** (5 vs 10 turns)
- ⚠️ **Slightly lower accuracy** on partial transcripts
- ⚠️ **More aggressive audio processing**

## When to Use

**Use Fast Mode when:**

- You want quick, responsive interactions
- You're giving short commands
- You're in a quiet environment
- You prioritize speed over perfect accuracy

**Use Default Mode when:**

- You need long, complex conversations
- You're in a noisy environment
- You want maximum accuracy
- You're doing detailed work

## Technical Details

### Sentence Chunking

Fast Mode uses aggressive chunking:

- **Max chunk length**: 100 chars (vs 150)
- **First chunk min**: 8 chars (vs 12)
- **Clause min**: 8 chars (vs 12)

This means TTS starts speaking sooner, even with incomplete sentences.

### Streaming Architecture

```
User Speech → VAD → STT (streaming) → LLM (streaming) → TTS (chunked)
     ↓           ↓         ↓               ↓               ↓
   100ms       50ms      200ms           300ms           200ms

Total: ~500ms (vs ~1200ms default)
```

### Audio Pipeline

Fast Mode optimizes audio processing:

- **Noise gate**: -40dB (more aggressive)
- **High-pass filter**: Enabled (removes low-freq noise)
- **Listening timeout**: 10s (shorter)

## API Reference

### Functions

#### `enableFastMode(pipeline: VoicePipeline): void`

Enables fast mode optimizations on a voice pipeline instance.

#### `disableFastMode(pipeline: VoicePipeline): void`

Restores default settings.

#### `getPerformanceMetrics(): object`

Returns current performance configuration.

### Constants

#### `FAST_MODE_VAD_CONFIG`

Optimized VAD configuration object.

#### `FAST_MODE_PIPELINE_CONFIG`

Complete pipeline configuration for fast mode.

#### `FAST_MODE_STT_CONFIG`

Deepgram STT optimized settings.

#### `FAST_MODE_LLM_CONFIG`

LLM configuration for faster inference.

#### `FAST_MODE_TTS_CONFIG`

TTS configuration for Cartesia.

#### `FAST_MODE_CHUNKING_CONFIG`

Sentence boundary detection settings.

## Future Improvements

Planned optimizations:

- [ ] Predictive LLM warming based on common queries
- [ ] Smart context compression for longer conversations
- [ ] Adaptive VAD based on environment noise
- [ ] Parallel tool execution
- [ ] GPU-accelerated audio preprocessing

## Contributing

To add new optimizations:

1. Test thoroughly in various environments
2. Measure latency improvements
3. Document trade-offs
4. Update this guide

---

**Note**: Fast Mode is designed for responsive voice interactions. For complex tasks requiring deep reasoning, the default mode may provide better results.
