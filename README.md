# Nova Desktop

A voice-first AI desktop assistant built with Electron, featuring wake word detection, speech recognition, LLM integration, and text-to-speech capabilities.

## Features

- **Wake Word Detection** - "Hey Nova" activation using Porcupine
- **Voice Activity Detection (VAD)** - Silero VAD for speech segmentation
- **Speech-to-Text** - Deepgram (primary) with Vosk offline fallback
- **LLM Integration** - Fireworks AI (primary) with OpenRouter fallback
- **Text-to-Speech** - ElevenLabs (primary) with Piper/espeak offline fallback
- **Automatic Fallback** - Circuit breaker pattern for provider switching
- **Cross-platform** - Windows, macOS, and Linux support

## Prerequisites

- Node.js 18+ 
- npm or yarn
- API Keys (see Configuration)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd nova-desktop

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Add your API keys to .env
```

## Configuration

Create a `.env` file with your API keys:

```env
# Required
PORCUPINE_API_KEY=your_porcupine_key      # Get from picovoice.ai
DEEPGRAM_API_KEY=your_deepgram_key        # Get from deepgram.com
FIREWORKS_API_KEY=your_fireworks_key      # Get from fireworks.ai
ELEVENLABS_API_KEY=your_elevenlabs_key    # Get from elevenlabs.io

# Optional (fallback providers)
OPENROUTER_API_KEY=your_openrouter_key    # Get from openrouter.ai

# Optional settings
LOG_LEVEL=info                             # debug, info, warn, error
NOVA_ENV=development                       # development, production
```

## Development

```bash
# Start development server
npm run dev

# Run tests
npm run test

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Building

```bash
# Build for production
npm run build

# Build outputs to dist/ directory
```

## Architecture

```
nova-desktop/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── config/           # Configuration management
│   │   ├── ipc/              # IPC handlers for renderer
│   │   ├── llm/              # LLM providers (Fireworks, OpenRouter)
│   │   ├── stt/              # STT providers (Deepgram, Vosk)
│   │   ├── tts/              # TTS providers (ElevenLabs, Piper)
│   │   ├── utils/            # Logging, errors, utilities
│   │   └── voice/            # Wake word, VAD, audio pipeline
│   ├── renderer/             # Electron renderer (React)
│   └── shared/               # Shared types and interfaces
├── tests/                    # Test files
└── docs/                     # Documentation
```

## Voice Pipeline Flow

```
Microphone → Wake Word → VAD → STT → LLM → TTS → Speaker
     ↓           ↓        ↓     ↓      ↓     ↓
  Audio      "Hey Nova"  Speech Text Response Audio
  Stream     Detection   Detect  →    →      Output
```

## API Overview

### STT (Speech-to-Text)

```typescript
import { getSTTManager } from './stt';

const sttManager = getSTTManager();

// Transcribe audio
const result = await sttManager.transcribe(audioBuffer);
console.log(result.text);

// Stream transcription
sttManager.on('transcript', (text, isFinal) => {
  console.log(text, isFinal ? '(final)' : '(interim)');
});
await sttManager.startStreaming();
sttManager.sendAudio(chunk);
await sttManager.stopStreaming();
```

### LLM (Language Model)

```typescript
import { getLLMManager } from './llm';

const llmManager = getLLMManager();

// Generate response
const response = await llmManager.generate('Hello, how are you?');
console.log(response.text);

// Stream response
for await (const chunk of llmManager.generateStream('Tell me a story')) {
  process.stdout.write(chunk.text);
}
```

### TTS (Text-to-Speech)

```typescript
import { getTTSManager } from './tts';

const ttsManager = getTTSManager();

// Synthesize speech
const audio = await ttsManager.synthesize('Hello world');

// Queue speech with priority
await ttsManager.speak('Important message', 10); // priority 10
await ttsManager.speak('Normal message', 1);     // priority 1
```

### Voice Pipeline

```typescript
import { getVoicePipeline } from './voice/voice-pipeline';

const pipeline = getVoicePipeline();

// Listen for events
pipeline.on('wakeWord', () => console.log('Wake word detected!'));
pipeline.on('speechStart', () => console.log('User speaking...'));
pipeline.on('transcript', (text) => console.log('User said:', text));
pipeline.on('response', (text) => console.log('Nova says:', text));

// Start pipeline
await pipeline.start();

// Stop pipeline
await pipeline.stop();
```

## IPC API (Renderer)

The renderer process can interact with Nova via the exposed API:

```typescript
// In renderer process
const { nova } = window;

// Start/stop voice pipeline
await nova.voicePipeline.start();
await nova.voicePipeline.stop();

// Get current state
const state = await nova.voicePipeline.getState();

// Listen for events
nova.voicePipeline.onStateChange((state) => {
  console.log('Pipeline state:', state);
});

nova.voicePipeline.onTranscript((text, isFinal) => {
  console.log('Transcript:', text);
});

nova.voicePipeline.onResponse((text) => {
  console.log('Response:', text);
});
```

## Provider Fallback

Nova automatically switches to fallback providers when primary providers fail:

| Service | Primary | Fallback |
|---------|---------|----------|
| STT | Deepgram | Vosk (offline) |
| LLM | Fireworks AI | OpenRouter |
| TTS | ElevenLabs | Piper/espeak (offline) |

The circuit breaker activates after 3 consecutive failures and automatically retries the primary provider after 60 seconds.

## Testing

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- tests/stt.test.ts

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Troubleshooting

### Wake word not detecting
- Ensure `PORCUPINE_API_KEY` is set correctly
- Check microphone permissions
- Verify microphone is not muted

### STT not working
- Check `DEEPGRAM_API_KEY` is valid
- Verify internet connection (for Deepgram)
- Vosk will activate automatically as fallback

### LLM responses failing
- Verify `FIREWORKS_API_KEY` is set
- Check API rate limits
- OpenRouter fallback requires `OPENROUTER_API_KEY`

### TTS not producing audio
- Check `ELEVENLABS_API_KEY` is valid
- Verify speaker/audio output device
- Piper fallback requires model download (automatic)

### General debugging
```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Check logs in
# - Console output
# - ~/.nova/logs/ directory
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request
