# Atlas Desktop Features

Atlas is a voice-first AI desktop assistant that combines cutting-edge speech technology with a beautiful 3D visualization. Here's everything Atlas can do for you.

---

## Voice Interaction

### Natural Conversation

- **Wake Word Activation** - Just say "Hey Atlas" to start talking
- **Continuous Listening** - Speak naturally without button presses
- **Barge-In Support** - Interrupt Atlas mid-response and it will stop to listen
- **Adaptive Silence Detection** - Atlas knows when you're pausing to think vs. finished speaking

### Speech Recognition

- **Real-Time Transcription** - See your words as you speak them
- **High Accuracy** - Powered by Deepgram's Nova-2 model
- **Offline Fallback** - Vosk enables voice recognition without internet
- **Noise Reduction** - Built-in audio preprocessing for cleaner input

### Voice Output

- **Natural Voice Synthesis** - Premium voices via ElevenLabs
- **Streaming Audio** - Hear responses as they're generated, no waiting
- **Echo Cancellation** - Atlas won't hear itself and loop
- **Offline Fallback** - Piper/espeak for voice output without internet

---

## Visual Experience

### The Atlas Orb

A mesmerizing 3D particle visualization that brings Atlas to life:

| State     | Appearance                   | Meaning                 |
| --------- | ---------------------------- | ----------------------- |
| Idle      | Cyan particles, gentle orbit | Ready and waiting       |
| Listening | Green glow, expanding        | Hearing your voice      |
| Thinking  | Purple swirl                 | Processing your request |
| Speaking  | Orange pulse                 | Responding to you       |

### Performance Optimized

- **60 FPS Target** - Smooth animations on any hardware
- **Dynamic LOD** - Automatically adjusts particle count for your GPU
- **Quality Presets** - Choose Low/Medium/High/Ultra based on preference
- **GPU Detection** - Auto-configures for integrated or dedicated graphics

### Audio-Reactive

- The orb responds to Atlas's voice with real-time audio analysis
- Bass frequencies control particle expansion
- Treble frequencies influence rotation speed

---

## AI Intelligence

### Conversational AI

- **DeepSeek V3.1** - State-of-the-art language model via Fireworks AI
- **Context Awareness** - Remembers your conversation history
- **Personality System** - Configurable traits (friendliness, formality, humor)
- **Emotion Detection** - Adapts tone based on your mood

### Memory System

- **Conversation Memory** - Recalls what you talked about
- **Preference Learning** - Remembers your likes and dislikes
- **Fact Extraction** - Stores important information about you
- **Semantic Search** - Retrieves relevant memories when needed

### Skills

Built-in capabilities that Atlas can invoke:

| Skill      | Description                       |
| ---------- | --------------------------------- |
| Calculator | Math calculations and conversions |
| Timer      | Set reminders and alarms          |
| Weather    | Current conditions and forecasts  |

---

## Developer Tools

### Git Integration

Atlas can help you manage your code repositories:

- **Status** - See modified files and branch info
- **Commit** - Stage and commit changes with AI-generated messages
- **Branch** - Create, switch, and merge branches
- **Push/Pull** - Sync with remote repositories
- **Conflict Resolution** - AI-assisted merge conflict handling

### Terminal Access

- Execute shell commands via voice
- Sandboxed execution for safety
- Audit trail of all operations

### File Operations

- Read, write, and search files
- Context-aware code understanding

### Browser Automation

- **Web Navigation** - Open URLs, click elements, fill forms
- **Screenshot Capture** - Take screenshots of web pages
- **CDP Integration** - Chrome DevTools Protocol for advanced control
- **Brave Browser Support** - Auto-detection and integration

### Desktop Integration

- **Application Launching** - Open any installed application
- **Window Management** - Focus, minimize, maximize windows
- **Clipboard Access** - Read and write clipboard content
- **Screenshot Analysis** - Capture and analyze screen content

---

## Privacy & Security

### Secure by Design

- **System Keychain** - API keys stored securely in OS credential manager
- **Encrypted Logs** - Conversation history encrypted at rest
- **Permission System** - Dangerous operations require explicit approval
- **Audit Trail** - Complete log of all tool executions

### Privacy Mode

- **No-Logging Option** - Disable all conversation storage
- **Data Export** - Download all your data anytime
- **Data Deletion** - Permanently remove stored information

---

## Platform Support

### Cross-Platform

- Windows 10/11
- macOS 11+ (Intel and Apple Silicon)
- Linux (Ubuntu 20.04+, Fedora 35+)

### System Integration

- **System Tray** - Quick access from the taskbar
- **Global Hotkeys** - Activate Atlas from anywhere
- **Auto-Start** - Launch with your computer
- **Auto-Update** - Seamless updates in the background

---

## Accessibility

### Keyboard Navigation

- Full keyboard control without mouse
- Tab navigation through all UI elements
- Keyboard shortcuts for common actions

### Screen Reader Support

- ARIA labels throughout the interface
- Announcements for state changes
- Compatible with NVDA, VoiceOver, JAWS

### Visual Options

- High contrast mode
- Reduced motion option
- Adjustable font sizes

---

## Configuration

### Voice Settings

- Select input/output devices
- Adjust microphone sensitivity
- Configure wake word sensitivity (0.0-1.0)
- Choose TTS voice and speed

### Personality Settings

- **Friendliness** - How warm and approachable Atlas sounds
- **Formality** - Casual vs. professional tone
- **Humor** - How often Atlas makes jokes
- **Curiosity** - How many follow-up questions Atlas asks
- **Energy** - Enthusiasm level in responses

### Performance Settings

- Quality presets (Low/Medium/High/Ultra)
- Particle count adjustment
- Effect toggles (bloom, glow)

---

## Offline Mode

Atlas works even without internet:

| Feature            | Online       | Offline        |
| ------------------ | ------------ | -------------- |
| Speech Recognition | Deepgram     | Vosk           |
| AI Responses       | Fireworks AI | Cached/Limited |
| Voice Output       | ElevenLabs   | Piper/espeak   |

Automatic fallback - you don't need to do anything!

---

## Performance Targets

| Metric                 | Target |
| ---------------------- | ------ |
| Wake word detection    | <200ms |
| Speech-to-text latency | <300ms |
| LLM first token        | <2s    |
| TTS first audio        | <500ms |
| Total response time    | <3s    |
| Orb frame rate         | 60 FPS |
| Memory usage           | <500MB |

---

## Coming Soon

- **Custom Wake Words** - Train Atlas to respond to any phrase
- **Plugin System** - Install third-party skills
- **Voice Cloning** - Give Atlas your own voice
- **Multi-Modal** - Image understanding and screen reading
- **Local LLM** - Run AI completely offline with Ollama
- **OCR Text Extraction** - Read text from images and screenshots
- **UI Template Matching** - Visual automation for any application
- **Dashboard UI** - Visual workflow builder and task management
- **Selective Forgetting** - Control what Atlas remembers

---

## Get Started

1. Download Atlas for your platform
2. Add your API keys (free tiers available)
3. Say "Hey Atlas" and start talking!

See the [User Guide](./docs/USER-GUIDE.md) for detailed setup instructions.
