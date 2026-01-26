<p align="center">
  <img src="assets/icons/icon.png" alt="Atlas Logo" width="128" height="128">
</p>

<h1 align="center">Atlas Desktop</h1>

<p align="center">
  <strong>Your Voice-First AI Assistant</strong>
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#installation">Installation</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

Atlas is a voice-first AI desktop assistant that combines cutting-edge speech technology with a beautiful 3D visualization. Just say "Hey Atlas" to start a natural conversation with an AI that remembers you, understands context, and can help with everything from answering questions to managing your code.

## Features

### Voice-First Interaction

- **Wake Word Activation** - Say "Hey Atlas" to start talking
- **Natural Conversation** - Speak naturally without button presses
- **Barge-In Support** - Interrupt Atlas mid-response
- **Offline Fallback** - Works without internet using local models

### Stunning Visual Orb

- **3D Particle Visualization** - 35,000 particles in a strange attractor pattern
- **State Animations** - See Atlas listen, think, and speak
- **Audio-Reactive** - The orb pulses with Atlas's voice
- **60 FPS Performance** - Smooth on any hardware

### Powerful AI

- **DeepSeek V3.1** - State-of-the-art language model via Fireworks AI
- **Conversation Memory** - Atlas remembers what you talked about
- **Personality System** - Customize how Atlas sounds and behaves
- **Skill System** - Calculator, Timer, Weather, and more

### Developer Tools

- **Git Integration** - Status, commit, branch, and merge via voice
- **Terminal Access** - Run shell commands safely
- **File Operations** - Read, write, and search your codebase

### Privacy & Security

- **Secure Credential Storage** - API keys in system keychain
- **Encrypted Logs** - Conversation history protected at rest
- **Permission System** - Approval required for dangerous operations
- **Privacy Mode** - Optional no-logging mode

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Quick Install

```bash
# Clone the repository
git clone https://github.com/benedict-anokye-davies/atlas-ai.git
cd atlas-ai

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys
```

### API Keys

Atlas requires API keys from these services (all have free tiers):

| Service      | Purpose             | Get Key                                |
| ------------ | ------------------- | -------------------------------------- |
| Picovoice    | Wake word detection | [picovoice.ai](https://picovoice.ai)   |
| Deepgram     | Speech recognition  | [deepgram.com](https://deepgram.com)   |
| Fireworks AI | AI responses        | [fireworks.ai](https://fireworks.ai)   |
| ElevenLabs   | Voice synthesis     | [elevenlabs.io](https://elevenlabs.io) |

Add your keys to `.env`:

```env
PORCUPINE_API_KEY=your_porcupine_key
DEEPGRAM_API_KEY=your_deepgram_key
FIREWORKS_API_KEY=your_fireworks_key
ELEVENLABS_API_KEY=your_elevenlabs_key
```

## Quick Start

```bash
# Start Atlas
npm run dev

# Say "Hey Atlas" or click the orb
# Start talking!
```

### Keyboard Shortcuts

| Shortcut           | Action              |
| ------------------ | ------------------- |
| `Ctrl+Shift+Space` | Push-to-talk        |
| `Ctrl+Shift+M`     | Toggle mute         |
| `Ctrl+Shift+S`     | Open settings       |
| `Escape`           | Stop Atlas speaking |

## Documentation

| Guide                                        | Description                |
| -------------------------------------------- | -------------------------- |
| [Features](./docs/FEATURES.md)               | Complete feature list      |
| [User Guide](./docs/USER-GUIDE.md)           | How to use Atlas           |
| [Developer Guide](./docs/DEVELOPER-GUIDE.md) | Contributing and extending |
| [API Reference](./docs/API.md)               | Technical documentation    |
| [Changelog](./CHANGELOG.md)                  | Version history            |

## Architecture

```
atlas-desktop/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── voice/            # Wake word, VAD, audio pipeline
│   │   ├── stt/              # Speech-to-text (Deepgram, Vosk)
│   │   ├── llm/              # Language models (Fireworks, OpenRouter)
│   │   ├── tts/              # Text-to-speech (ElevenLabs, Piper)
│   │   ├── memory/           # Conversation and knowledge storage
│   │   ├── agent/            # Tools and skills
│   │   └── security/         # Permissions and sandboxing
│   ├── renderer/             # React frontend
│   │   ├── components/orb/   # 3D visualization
│   │   └── hooks/            # State management
│   └── shared/               # Shared types
├── tests/                    # Test suite
└── docs/                     # Documentation
```

## Voice Pipeline

```
Microphone → Wake Word → VAD → STT → LLM → TTS → Speaker
                ↓          ↓     ↓      ↓     ↓
           "Hey Atlas"  Speech  Text Response Audio
```

## Provider Fallback

Atlas automatically falls back to offline providers when primary services fail:

| Service | Primary      | Fallback               |
| ------- | ------------ | ---------------------- |
| STT     | Deepgram     | Vosk (offline)         |
| LLM     | Fireworks AI | OpenRouter             |
| TTS     | ElevenLabs   | Piper/espeak (offline) |

## Development

```bash
# Run tests
npm run test

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build
```

## Building for Distribution

```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

## Performance

| Metric            | Target | Actual |
| ----------------- | ------ | ------ |
| Wake word latency | <200ms | ~150ms |
| STT latency       | <300ms | ~200ms |
| LLM first token   | <2s    | ~1.5s  |
| TTS first audio   | <500ms | ~300ms |
| Total response    | <3s    | ~2.5s  |
| Orb frame rate    | 60 FPS | 60 FPS |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

## Roadmap

- [ ] Custom wake words
- [ ] Plugin system for third-party skills
- [ ] Voice cloning
- [ ] Multi-modal (image understanding)
- [ ] Local LLM support via Ollama
- [ ] OCR text extraction
- [ ] UI template matching for visual automation
- [ ] Dashboard UI with workflow builder

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Acknowledgments

- [Picovoice](https://picovoice.ai) - Wake word detection
- [Deepgram](https://deepgram.com) - Speech recognition
- [Fireworks AI](https://fireworks.ai) - Language model hosting
- [ElevenLabs](https://elevenlabs.io) - Voice synthesis
- [Three.js](https://threejs.org) - 3D graphics

---

<p align="center">
  Built by Ben
</p>
