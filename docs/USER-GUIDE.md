# Atlas Desktop - User Guide

**Version 0.2.0** | **Voice-First AI Desktop Assistant**

Welcome to Atlas, your voice-first AI desktop assistant. This guide will help you get started and make the most of Atlas's features.

---

## Table of Contents

1. [Introduction](#introduction)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [First-Time Setup](#first-time-setup)
5. [Using Atlas](#using-atlas)
6. [Voice Commands](#voice-commands)
7. [Configuration](#configuration)
8. [Agent Tools](#agent-tools)
9. [Troubleshooting](#troubleshooting)
10. [FAQ](#faq)

---

## Introduction

Atlas is a powerful voice-first AI assistant that runs directly on your desktop. Unlike cloud-based assistants, Atlas prioritizes your privacy by keeping your data local while still offering powerful AI capabilities through configurable cloud services.

### Key Features

- **Voice-First Interaction**: Say "Hey Atlas" (or your chosen wake word) to start talking
- **Natural Conversation**: Powered by advanced LLMs for human-like responses
- **Agent Tools**: File management, terminal commands, web search, Git operations, and more
- **Visual Orb Interface**: Beautiful 3D particle visualization that responds to your voice
- **Memory System**: Atlas remembers your conversations and preferences
- **Offline Fallback**: Works offline with reduced functionality when internet is unavailable

---

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| Operating System | Windows 10/11, macOS 11+, Linux (Ubuntu 20.04+) |
| CPU | 4-core processor |
| RAM | 8 GB |
| GPU | Integrated graphics |
| Storage | 2 GB available space |
| Network | Internet connection for cloud services |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| CPU | 6-core processor |
| RAM | 16 GB |
| GPU | 4 GB+ VRAM (dedicated graphics) |
| Storage | 10 GB available space |
| Microphone | USB microphone or quality headset |

---

## Installation

### Windows

1. Download the latest `Atlas-Setup-x.x.x.exe` from the [Releases](https://github.com/atlas-desktop/releases) page
2. Run the installer and follow the on-screen instructions
3. Launch Atlas from the Start menu or desktop shortcut

### macOS

1. Download the latest `Atlas-x.x.x.dmg` from the [Releases](https://github.com/atlas-desktop/releases) page
2. Open the DMG file and drag Atlas to your Applications folder
3. On first launch, right-click Atlas and select "Open" to bypass Gatekeeper

### Linux

1. Download the latest `Atlas-x.x.x.AppImage` from the [Releases](https://github.com/atlas-desktop/releases) page
2. Make the file executable: `chmod +x Atlas-x.x.x.AppImage`
3. Run the AppImage: `./Atlas-x.x.x.AppImage`

### Building from Source

```bash
# Clone the repository
git clone https://github.com/benedict-anokye-davies/atlas-ai.git
cd atlas-desktop

# Install dependencies
npm install

# Start development mode
npm run dev

# Or build for production
npm run build
```

---

## First-Time Setup

### Step 1: Obtain API Keys

Atlas requires several API keys to function. Here is how to obtain each one:

#### Required API Keys

| Service | Purpose | How to Get |
|---------|---------|------------|
| **Porcupine** | Wake word detection | Sign up at [picovoice.ai](https://picovoice.ai/), free tier available |
| **Fireworks AI** | Primary LLM | Sign up at [fireworks.ai](https://fireworks.ai/), free tier available |

#### Optional API Keys (with fallbacks)

| Service | Purpose | Fallback | How to Get |
|---------|---------|----------|------------|
| **Deepgram** | Speech-to-text | Vosk (offline) | Sign up at [deepgram.com](https://deepgram.com/), $200 free credit |
| **ElevenLabs** | Text-to-speech | System voice | Sign up at [elevenlabs.io](https://elevenlabs.io/), 10k chars/month free |
| **OpenRouter** | Fallback LLM | None | Sign up at [openrouter.ai](https://openrouter.ai/), pay-per-use |

### Step 2: Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys:
   ```env
   # Required
   PORCUPINE_API_KEY=your_porcupine_key_here
   FIREWORKS_API_KEY=your_fireworks_key_here

   # Optional (with fallbacks)
   DEEPGRAM_API_KEY=your_deepgram_key_here
   ELEVENLABS_API_KEY=your_elevenlabs_key_here
   OPENROUTER_API_KEY=your_openrouter_key_here
   ```

### Step 3: Test Your Setup

1. Launch Atlas
2. You should see the orb visualization appear
3. Say "Hey Atlas" (or click the orb)
4. Try a simple query like "Hello, what can you do?"

If everything is working, Atlas will respond with its voice and the orb will animate accordingly.

---

## Using Atlas

### Wake Word Activation

Atlas listens for a wake word to start a conversation. The default wake phrase is "Hey Atlas" (using the built-in "Jarvis" keyword until a custom model is available).

**Available wake words:**
- "Hey Atlas" (default)
- "Computer"
- "Jarvis"
- "Hey Siri"
- "Alexa"

You can enable or disable wake words in the settings.

### Click-to-Activate

Alternatively, click directly on the orb to activate listening mode. This is useful in quiet environments or when you prefer not to speak the wake word.

### Push-to-Talk

For continuous control, use Push-to-Talk:
- **Default Hotkey**: `Ctrl+Space`
- Hold to talk, release when finished speaking

### Understanding the Orb

The orb's visual state indicates what Atlas is doing:

| State | Visual Appearance | Meaning |
|-------|-------------------|---------|
| **Idle** | Slow, gentle rotation | Waiting for wake word |
| **Listening** | Particles converge, pulsing cyan | Capturing your speech |
| **Thinking** | Rapid rotation, yellow/amber glow | Processing your request |
| **Speaking** | Particles expand, green/blue glow | Speaking the response |
| **Error** | Particles scatter, red pulses | An error occurred |

### Interrupting Atlas

You can interrupt Atlas at any time by:
- Saying the wake word while Atlas is speaking
- Clicking the orb
- Using the Push-to-Talk hotkey

---

## Voice Commands

Atlas understands natural language, so you do not need to memorize specific commands. Just speak naturally and Atlas will understand your intent.

### Common Requests

**General Questions:**
- "What's the weather like?"
- "Tell me a joke"
- "What time is it?"

**File Operations:**
- "Read the file readme.md"
- "What files are in this folder?"
- "Search for files containing 'config'"

**Terminal Commands:**
- "Run npm install"
- "Show me the git status"
- "List running processes"

**Web Search:**
- "Search for TypeScript tutorials"
- "What's the latest news about AI?"

**Git Operations:**
- "Show me recent commits"
- "Create a commit with message 'fix: updated config'"
- "What branches exist?"

For a complete reference, see the [Voice Commands Guide](./guides/voice-commands.md).

---

## Configuration

### Environment Variables

All configuration is managed through environment variables in the `.env` file:

```env
# ===========================================
# API Keys (Required)
# ===========================================
PORCUPINE_API_KEY=your_porcupine_key
FIREWORKS_API_KEY=your_fireworks_key

# ===========================================
# API Keys (Optional)
# ===========================================
DEEPGRAM_API_KEY=your_deepgram_key
ELEVENLABS_API_KEY=your_elevenlabs_key
OPENROUTER_API_KEY=your_openrouter_key

# ===========================================
# ElevenLabs Settings
# ===========================================
ELEVENLABS_VOICE_ID=onyx

# ===========================================
# LLM Settings
# ===========================================
FIREWORKS_MODEL=accounts/fireworks/models/deepseek-r1
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# ===========================================
# Voice Settings
# ===========================================
WAKE_WORD_SENSITIVITY=0.5    # 0.0-1.0 (higher = more sensitive)
VAD_THRESHOLD=0.5            # Voice activity detection threshold
VAD_SILENCE_DURATION=1500    # Silence duration before processing (ms)

# ===========================================
# Audio Settings
# ===========================================
AUDIO_SAMPLE_RATE=16000      # Sample rate in Hz
AUDIO_CHANNELS=1             # Mono audio

# ===========================================
# Logging
# ===========================================
LOG_LEVEL=debug              # debug, info, warn, error
LOG_DIR=~/.atlas/logs        # Log file directory

# ===========================================
# User Settings
# ===========================================
USER_NAME=User               # Your name for personalization
```

### Configuration Details

#### Wake Word Sensitivity

Controls how easily the wake word is detected:
- **Lower values (0.3-0.5)**: More strict, fewer false positives
- **Higher values (0.6-0.8)**: More lenient, may trigger accidentally

Adjust based on your environment:
- **Quiet room**: 0.5 (default)
- **Noisy environment**: 0.3-0.4
- **Having detection issues**: 0.6-0.7

#### VAD (Voice Activity Detection)

Controls how Atlas determines when you have finished speaking:
- **VAD_THRESHOLD**: Speech detection sensitivity (0.0-1.0)
- **VAD_SILENCE_DURATION**: How long to wait after you stop speaking before processing (milliseconds)

For faster responses, lower the silence duration (1000ms). For more natural pauses, increase it (2000ms).

#### Logging

Logs are stored in `~/.atlas/logs/` by default with daily rotation. Log levels:
- **debug**: All messages (verbose)
- **info**: General information
- **warn**: Warnings only
- **error**: Errors only

---

## Agent Tools

Atlas has access to powerful tools for interacting with your system:

### Filesystem Tools

| Tool | Description |
|------|-------------|
| `file_read` | Read contents of a file |
| `file_write` | Write content to a file |
| `file_delete` | Delete a file |
| `file_list` | List files in a directory |
| `file_search` | Search for files by pattern |

**Examples:**
- "Read the package.json file"
- "Create a file called notes.txt with 'Hello World'"
- "Find all TypeScript files"

### Terminal Tools

| Tool | Description |
|------|-------------|
| `terminal_execute` | Run a shell command |

**Examples:**
- "Run npm test"
- "Show disk usage"
- "List all Docker containers"

**Note:** Dangerous commands require confirmation before execution.

### Browser Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Open a URL |
| `browser_screenshot` | Capture a webpage |
| `browser_click` | Click an element |
| `browser_type` | Type text into an element |

**Examples:**
- "Open GitHub"
- "Take a screenshot of the current page"

### Git Tools

| Tool | Description |
|------|-------------|
| `git_status` | Show repository status |
| `git_log` | Show commit history |
| `git_diff` | Show file differences |
| `git_commit` | Create a commit |
| `git_branch` | List or create branches |
| `git_checkout` | Switch branches |

**Examples:**
- "What's the git status?"
- "Show the last 5 commits"
- "Create a commit with message 'feat: add new feature'"

### Search Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web |
| `fetch_url` | Fetch content from a URL |

**Examples:**
- "Search for React best practices"
- "What's on the Hacker News homepage?"

### Screenshot Tools

| Tool | Description |
|------|-------------|
| `screenshot_capture` | Capture the screen |
| `screenshot_window` | Capture a specific window |

### Clipboard Tools

| Tool | Description |
|------|-------------|
| `clipboard_read` | Read clipboard contents |
| `clipboard_write` | Write to clipboard |

**Examples:**
- "What's in my clipboard?"
- "Copy 'Hello World' to my clipboard"

---

## Troubleshooting

### Wake Word Not Detecting

**Symptoms:** Atlas does not respond when you say the wake word.

**Solutions:**
1. **Check your API key:** Ensure `PORCUPINE_API_KEY` is set correctly in `.env`
2. **Check microphone permissions:** Atlas needs microphone access
3. **Verify microphone selection:** Make sure the correct input device is selected
4. **Adjust sensitivity:** Increase `WAKE_WORD_SENSITIVITY` (try 0.6-0.7)
5. **Check audio levels:** Speak clearly and at a normal volume
6. **Reduce background noise:** Move to a quieter environment

### No LLM Response

**Symptoms:** Atlas hears you but does not respond.

**Solutions:**
1. **Check API keys:** Verify `FIREWORKS_API_KEY` is set correctly
2. **Check network:** Ensure you have internet connectivity
3. **Check logs:** Look at `~/.atlas/logs/` for error messages
4. **Try fallback:** Ensure `OPENROUTER_API_KEY` is set as backup

### Speech-to-Text Issues

**Symptoms:** Atlas does not understand what you say.

**Solutions:**
1. **Check Deepgram key:** Verify `DEEPGRAM_API_KEY` is valid
2. **Check microphone:** Ensure your microphone is working properly
3. **Speak clearly:** Enunciate words and avoid speaking too fast
4. **Reduce noise:** Background noise can interfere with recognition

### Text-to-Speech Issues

**Symptoms:** Atlas does not speak or sounds wrong.

**Solutions:**
1. **Check ElevenLabs key:** Verify `ELEVENLABS_API_KEY` is valid
2. **Check voice ID:** Ensure `ELEVENLABS_VOICE_ID` is a valid voice
3. **Check audio output:** Verify your speakers or headphones are working
4. **Use fallback:** If ElevenLabs fails, the system voice will be used

### Electron/App Not Starting

**Symptoms:** The application fails to launch.

**Solutions:**
1. **Check dependencies:** Run `npm install` to ensure all packages are installed
2. **Check port conflicts:** Port 5173 must be available for Vite
3. **Check terminal output:** Look for error messages in the console
4. **Rebuild native modules:** Run `npm run prepare`

### Performance Issues

**Symptoms:** The orb is laggy or the app uses too much CPU/memory.

**Solutions:**
1. **Reduce particle count:** Lower quality settings for the orb
2. **Close other applications:** Free up system resources
3. **Check GPU:** Ensure hardware acceleration is enabled
4. **Update drivers:** Update your graphics drivers

---

## FAQ

### General Questions

**Q: Is my data sent to the cloud?**

A: Atlas uses cloud services for AI processing (LLM, STT, TTS), but your conversations and data are stored locally on your machine. API providers process your voice and text to generate responses, subject to their privacy policies.

**Q: Can I use Atlas offline?**

A: Yes, with reduced functionality. Offline mode uses Vosk for speech-to-text and system voices for text-to-speech. However, the LLM requires internet access.

**Q: How much do the API services cost?**

A: Most services offer generous free tiers:
- **Porcupine:** Free tier available
- **Deepgram:** $200 free credit
- **ElevenLabs:** 10,000 characters/month free
- **Fireworks AI:** Free tier available
- **OpenRouter:** Pay-per-use

For typical personal use, you may stay within free tiers.

### Technical Questions

**Q: What LLM models does Atlas support?**

A: Atlas uses Fireworks AI with DeepSeek V3.1 as the primary model. OpenRouter provides fallback access to many models including Claude, GPT-4, and others.

**Q: Can I use a local LLM?**

A: Currently, Atlas is designed for cloud LLMs. Local LLM support (via Ollama) is planned for a future release.

**Q: What languages does Atlas support?**

A: Atlas currently supports English. Multi-language support is planned for future releases.

**Q: How do I update Atlas?**

A: Atlas checks for updates automatically on startup. You will be prompted to install updates when available.

### Customization Questions

**Q: Can I change the wake word?**

A: Yes, you can choose from built-in wake words (Computer, Jarvis, Alexa, Hey Siri) in the settings. Custom wake words require training a Porcupine model.

**Q: Can I change the voice?**

A: Yes, change `ELEVENLABS_VOICE_ID` in your `.env` file. Available voices depend on your ElevenLabs account.

**Q: Can I customize the orb appearance?**

A: Visual customization options are planned for future releases. Currently, the orb adapts automatically based on state.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Push-to-talk (hold) |
| `Ctrl+Shift+A` | Toggle Atlas window |
| `Ctrl+Shift+M` | Toggle mute |
| `Escape` | Cancel current operation |
| `Ctrl+,` | Open settings |
| `Ctrl+H` | Toggle history panel |
| `Ctrl+W` | Toggle workflows panel |
| `Ctrl+N` | New conversation |

---

## Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs:** `~/.atlas/logs/` contains detailed error information
2. **Search issues:** Look for similar problems on the GitHub issues page
3. **Open an issue:** Report bugs or request features on GitHub
4. **Community:** Join our Discord server for community support

---

## Additional Resources

- [Getting Started Guide](./guides/getting-started.md) - Quick start tutorial
- [Voice Commands Reference](./guides/voice-commands.md) - Complete voice command list
- [Architecture Overview](./ARCHITECTURE.md) - Technical architecture documentation
- [API Documentation](./API.md) - API reference for developers

---

*Atlas Desktop - Your Voice-First AI Assistant*

**Version:** 0.2.0
**Last Updated:** January 2026
