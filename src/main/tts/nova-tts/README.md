# Nova TTS - Open Source Text-to-Speech Engine

> ️ A powerful, open-source alternative to ElevenLabs for Nova Desktop

## Overview

Nova TTS is a comprehensive text-to-speech system that combines multiple neural TTS backends into a unified API. It provides:

- **Multiple Engines**: Piper, Edge TTS, XTTS, StyleTTS2, OpenVoice, Bark, and more
- **Voice Cloning**: Create custom voices from just a few seconds of audio
- **Emotion Control**: Express happiness, sadness, anger, excitement, and more
- **Style Transfer**: Switch between conversational, narration, newscast, and other styles
- **Real-time Streaming**: Low-latency audio generation for responsive interactions
- **Local Models**: Run entirely offline with downloaded models
- **Free Options**: Edge TTS provides high-quality voices at no cost

## Quick Start

```typescript
import { getNovaTTS } from './src/main/tts/nova-tts';

// Initialize
const tts = getNovaTTS();
await tts.initialize();

// List available voices
const voices = tts.getVoices();
console.log(`Found ${voices.length} voices`);

// Speak with default voice
await tts.speak("Hello! I'm Nova, your AI assistant.");

// Speak with specific voice and emotion
await tts.speak("I'm so excited to help you today!", {
  voiceId: 'edge-en-us-aria',
  emotion: 'excited',
  style: 'conversational',
});
```

## Available Engines

### 1. Piper (Recommended for Local)
- **Quality**: High
- **Speed**: Very Fast (~10x real-time on CPU)
- **Offline**: [DONE] Yes
- **Voice Cloning**: [MISSING] No
- **Best For**: Low-latency local TTS

```typescript
// Piper voices
const piperVoices = tts.getVoices().filter(v => v.engine === 'piper');
```

### 2. Edge TTS (Recommended for Free Cloud)
- **Quality**: Very High
- **Speed**: Fast (network dependent)
- **Offline**: [MISSING] No (requires internet)
- **Voice Cloning**: [MISSING] No
- **Emotion/Style**: [DONE] Yes
- **Best For**: High-quality TTS without API costs

```typescript
// Edge TTS with emotion
await tts.speak("This is amazing news!", {
  voiceId: 'edge-en-us-jenny',
  emotion: 'happy',
  style: 'newscast',
});
```

### 3. XTTS v2 (Voice Cloning)
- **Quality**: Ultra High
- **Speed**: Moderate (GPU recommended)
- **Offline**: [DONE] Yes (after model download)
- **Voice Cloning**: [DONE] Yes (best quality)
- **Best For**: Creating custom voice clones

```typescript
// Clone a voice
const result = await tts.cloneVoice({
  name: 'My Voice',
  referenceAudioPaths: ['./my-voice-sample.wav'],
  engine: 'xtts',
  language: 'en-US',
  extractEmbedding: true,
});

// Use the cloned voice
await tts.speak("This is my cloned voice!", {
  voiceId: result.voice.id,
});
```

### 4. OpenVoice (Fast Voice Cloning)
- **Quality**: High
- **Speed**: Fast
- **Voice Cloning**: [DONE] Yes (zero-shot)
- **Best For**: Quick voice cloning with tone control

### 5. StyleTTS2 (Style Transfer)
- **Quality**: Ultra High
- **Speed**: Moderate
- **Style Transfer**: [DONE] Yes (reference audio)
- **Best For**: Matching speaking style from audio

### 6. Bark (Generative Audio)
- **Quality**: High
- **Special Features**: Laughing, sighing, non-verbal sounds
- **Best For**: Expressive, dynamic speech

## Voice Library

Nova TTS includes 50+ pre-configured voices across multiple engines:

### Premium Nova Voices (Recommended)
| Voice | Engine | Language | Description |
|-------|--------|----------|-------------|
| `nova-atlas` | Piper | en-GB | Warm British assistant (JARVIS-inspired) |
| `nova-aria` | Piper | en-US | Friendly American assistant |
| `nova-orion` | Piper | en-US | Authoritative American male |

### Edge TTS Voices (Free, High Quality)
| Voice | Gender | Language | Supports Emotion |
|-------|--------|----------|-----------------|
| `edge-en-us-jenny` | Female | en-US | [DONE] |
| `edge-en-us-guy` | Male | en-US | [DONE] |
| `edge-en-us-aria` | Female | en-US | [DONE] |
| `edge-en-gb-ryan` | Male | en-GB | [DONE] |
| `edge-en-gb-sonia` | Female | en-GB | [DONE] |

### Piper Voices (Fast, Local)
| Voice | Quality | Language | Size |
|-------|---------|----------|------|
| `piper-en-us-amy-medium` | Medium | en-US | 63MB |
| `piper-en-us-ryan-high` | High | en-US | 105MB |
| `piper-en-gb-alan-medium` | Medium | en-GB | 63MB |

## Emotions

Supported emotions (availability varies by engine):

| Emotion | Icon | Description |
|---------|------|-------------|
| `neutral` | 😐 | Default, balanced tone |
| `happy` | 😊 | Cheerful, upbeat |
| `sad` | 😢 | Melancholic, somber |
| `angry` | 😠 | Frustrated, intense |
| `excited` | 🤩 | Enthusiastic, energetic |
| `calm` | 😌 | Peaceful, relaxed |
| `serious` | 🧐 | Professional, grave |
| `playful` | 😜 | Fun, lighthearted |
| `warm` | 🥰 | Friendly, caring |
| `professional` | 👔 | Business-like, formal |

## Speaking Styles

| Style | Best For |
|-------|----------|
| `conversational` | Natural dialogue |
| `newscast` | News delivery |
| `narration` | Audiobooks, stories |
| `assistant` | AI assistant responses |
| `storytelling` | Engaging narratives |
| `documentary` | Informative content |
| `whispering` | Quiet, intimate |

## Voice Cloning Guide

### Requirements
- **Minimum**: 3-10 seconds of clear audio
- **Recommended**: 10-30 seconds for better quality
- **Best**: Multiple samples (30-60 seconds total)

### Audio Quality Tips
1. Record in a quiet environment
2. Use consistent volume and tone
3. Avoid background noise or music
4. Speak naturally at your normal pace
5. WAV format preferred (MP3/M4A supported)

### Cloning Example

```typescript
// Clone with XTTS (best quality)
const result = await tts.cloneVoice({
  name: 'CEO Voice',
  description: 'Corporate executive voice for announcements',
  referenceAudioPaths: [
    './ceo-sample-1.wav',
    './ceo-sample-2.wav',
  ],
  engine: 'xtts',
  language: 'en-US',
  extractEmbedding: true,
  fineTune: false, // Set true for better quality (slower)
});

if (result.success) {
  console.log(`Created voice: ${result.voice.id}`);
  console.log(`Quality score: ${result.qualityScore}`);
}
```

## Configuration

```typescript
import { getNovaTTS, NovaTTSConfig } from './nova-tts';

const config: Partial<NovaTTSConfig> = {
  // Default voice
  defaultVoiceId: 'nova-atlas',
  
  // Default engine
  defaultEngine: 'piper',
  
  // Model storage
  modelsPath: '/path/to/models',
  
  // Audio cache
  cachePath: '/path/to/cache',
  enableCache: true,
  maxCacheSizeMB: 500,
  
  // GPU settings
  gpuDeviceId: 0, // -1 for CPU only
  
  // Queue settings
  enableQueue: true,
  maxQueueSize: 100,
  maxConcurrent: 2,
};

const tts = getNovaTTS(config);
await tts.initialize();
```

## API Reference

### Core Methods

```typescript
// Initialize
await tts.initialize();

// Shutdown
await tts.shutdown();

// Simple speak
await tts.speak(text);

// Speak with options
await tts.speak(text, {
  voiceId: 'voice-id',
  emotion: 'happy',
  style: 'conversational',
  streaming: true,
  priority: 1,
});

// Full synthesis (returns audio buffer)
const result = await tts.synthesize(text, options);

// Streaming synthesis
for await (const chunk of tts.synthesizeStream(text, options)) {
  // Handle audio chunks
}
```

### Voice Management

```typescript
// Get all voices
const voices = tts.getVoices();

// Get recommended voices
const recommended = tts.getRecommendedVoices();

// Search voices
const results = tts.searchVoices('british male');

// Check if downloaded
const isReady = tts.isVoiceDownloaded('voice-id');

// Download voice
await tts.downloadVoice('voice-id');

// Delete voice
await tts.deleteVoice('voice-id');
```

### Voice Cloning

```typescript
// Clone voice
const result = await tts.cloneVoice({
  name: 'Custom Voice',
  referenceAudioPaths: ['./sample.wav'],
  engine: 'xtts',
  language: 'en-US',
});

// Delete cloned voice
await tts.deleteClonedVoice('voice-id');
```

### Playback Control

```typescript
// Stop playback
tts.stop();

// Pause
tts.pause();

// Resume
tts.resume();

// Check if speaking
const speaking = tts.isSpeaking();
```

### Queue Management

```typescript
// Get queue
const queue = tts.getQueue();

// Clear queue
tts.clearQueue();
```

### Events

```typescript
// Engine status
tts.on('engine-status', (engine, status) => {});

// Synthesis events
tts.on('synthesis-start', (id, text, options) => {});
tts.on('audio-chunk', (chunk) => {});
tts.on('synthesis-complete', (result) => {});
tts.on('synthesis-error', (id, error) => {});

// Playback events
tts.on('playback-start', () => {});
tts.on('playback-end', () => {});
tts.on('interrupted', () => {});

// Download progress
tts.on('download-progress', (progress) => {});

// Cloning progress
tts.on('clone-progress', (voiceId, stage, progress) => {});
tts.on('clone-complete', (result) => {});
```

## Comparison with ElevenLabs

| Feature | Nova TTS | ElevenLabs |
|---------|----------|------------|
| **Cost** | Free (open source) | $5-330/month |
| **Voice Cloning** | [DONE] Local | [DONE] Cloud |
| **Offline Mode** | [DONE] Yes | [MISSING] No |
| **Emotion Control** | [DONE] Yes | [DONE] Yes |
| **API Limits** | None | Based on plan |
| **Data Privacy** | Full control | Cloud processing |
| **Latency** | 50-200ms (local) | 200-500ms |
| **Custom Training** | [DONE] Possible | [DONE] Professional plan |

## Installation

Nova TTS requires some Python dependencies for advanced engines:

```bash
# Install edge-tts (free Microsoft TTS)
pip install edge-tts

# Install XTTS for voice cloning (optional)
pip install TTS

# Install torch with CUDA for GPU acceleration (optional)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

Piper is bundled with Nova Desktop and requires no additional installation.

## Troubleshooting

### Edge TTS not working
```bash
# Verify edge-tts is installed
python -m edge_tts --version

# Test with a simple synthesis
python -m edge_tts --text "Hello" --write-media test.mp3
```

### XTTS not available
```bash
# Check TTS installation
python -c "from TTS.tts.models.xtts import Xtts; print('OK')"

# Install if missing
pip install TTS
```

### Voice download fails
- Check internet connection
- Verify disk space
- Check model path permissions

### Audio quality issues
- Try a higher quality voice
- Adjust speed/pitch settings
- Use appropriate emotion/style

## License

Nova TTS is open source under the MIT license. Individual engines may have their own licenses:

- **Piper**: MIT
- **XTTS**: CPML (non-commercial) / Commercial license available
- **Edge TTS**: Microsoft Terms of Service
- **StyleTTS2**: MIT
- **OpenVoice**: MIT
- **Bark**: MIT

---

Built with ❤️ for the Nova Desktop project
