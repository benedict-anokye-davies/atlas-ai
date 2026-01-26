# Getting Started with Atlas

This guide will walk you through setting up Atlas from scratch and having your first conversation.

---

## Quick Start (5 Minutes)

### 1. Download and Install

**Windows:**
```
Download Atlas-Setup-x.x.x.exe from GitHub releases
Run the installer
```

**macOS:**
```
Download Atlas-x.x.x.dmg from GitHub releases
Drag Atlas to Applications
Right-click > Open (first time only)
```

**Linux:**
```bash
chmod +x Atlas-x.x.x.AppImage
./Atlas-x.x.x.AppImage
```

### 2. Get Your API Keys

You need at least two API keys to get started:

| Service | Required | Free Tier | Link |
|---------|----------|-----------|------|
| Picovoice (Porcupine) | Yes | Yes | [picovoice.ai](https://picovoice.ai/) |
| Fireworks AI | Yes | Yes | [fireworks.ai](https://fireworks.ai/) |
| Deepgram | Recommended | $200 credit | [deepgram.com](https://deepgram.com/) |
| ElevenLabs | Recommended | 10k chars/mo | [elevenlabs.io](https://elevenlabs.io/) |

### 3. Configure Your Keys

Create a `.env` file in the Atlas directory:

```env
PORCUPINE_API_KEY=your_porcupine_key_here
FIREWORKS_API_KEY=your_fireworks_key_here
DEEPGRAM_API_KEY=your_deepgram_key_here
ELEVENLABS_API_KEY=your_elevenlabs_key_here
```

### 4. Launch Atlas

1. Start Atlas from your applications menu or desktop
2. Wait for the orb to appear (this indicates Atlas is ready)
3. Say **"Hey Atlas"** or click the orb
4. Ask something like: **"Hello, what can you do?"**

Congratulations! You are now using Atlas.

---

## Detailed Setup Guide

### Step 1: Install Atlas

#### Option A: Use Pre-built Installer (Recommended)

1. Go to the [Atlas Releases](https://github.com/atlas-desktop/releases) page
2. Download the appropriate installer for your operating system:
   - Windows: `Atlas-Setup-x.x.x.exe`
   - macOS: `Atlas-x.x.x.dmg`
   - Linux: `Atlas-x.x.x.AppImage`
3. Run the installer and follow the prompts

#### Option B: Build from Source

If you prefer to build from source:

```bash
# Clone the repository
git clone https://github.com/benedict-anokye-davies/atlas-ai.git

# Navigate to the directory
cd atlas-desktop

# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Step 2: Obtain API Keys

#### Picovoice (Porcupine) - Wake Word Detection

1. Visit [picovoice.ai](https://picovoice.ai/)
2. Click "Console" or "Start Free"
3. Create an account (email verification required)
4. Navigate to the Porcupine section
5. Copy your Access Key

**Why this is required:** Porcupine detects when you say "Hey Atlas" so the app knows when to start listening.

#### Fireworks AI - Language Model

1. Visit [fireworks.ai](https://fireworks.ai/)
2. Click "Sign Up" and create an account
3. Navigate to API Keys in your dashboard
4. Create a new API key and copy it

**Why this is required:** Fireworks AI powers Atlas's intelligence, understanding your requests and generating responses.

#### Deepgram - Speech-to-Text (Recommended)

1. Visit [deepgram.com](https://deepgram.com/)
2. Sign up for a free account
3. You get $200 in free credit
4. Navigate to your Dashboard
5. Create an API key and copy it

**Why this is recommended:** Deepgram provides fast, accurate speech recognition. Without it, Atlas falls back to offline recognition which is less accurate.

#### ElevenLabs - Text-to-Speech (Recommended)

1. Visit [elevenlabs.io](https://elevenlabs.io/)
2. Create a free account
3. You get 10,000 characters per month free
4. Go to Profile > API Keys
5. Copy your API key

**Why this is recommended:** ElevenLabs provides natural-sounding voice responses. Without it, Atlas uses your system's built-in text-to-speech which sounds more robotic.

### Step 3: Configure Atlas

#### Finding the Configuration File

The `.env` file should be in your Atlas installation directory:

- **Windows:** `C:\Users\[YourName]\AppData\Local\Atlas\.env`
- **macOS:** `~/Library/Application Support/Atlas/.env`
- **Linux:** `~/.config/Atlas/.env`
- **Development:** The project root directory

#### Creating the Configuration

Create a new file called `.env` with the following content:

```env
# ================================================
# REQUIRED API KEYS
# ================================================

# Picovoice Porcupine - Wake word detection
PORCUPINE_API_KEY=your_porcupine_key_here

# Fireworks AI - Primary LLM
FIREWORKS_API_KEY=your_fireworks_key_here

# ================================================
# RECOMMENDED API KEYS (with offline fallbacks)
# ================================================

# Deepgram - Speech-to-text (fallback: Vosk offline)
DEEPGRAM_API_KEY=your_deepgram_key_here

# ElevenLabs - Text-to-speech (fallback: system voice)
ELEVENLABS_API_KEY=your_elevenlabs_key_here

# OpenRouter - Fallback LLM (optional but recommended)
OPENROUTER_API_KEY=your_openrouter_key_here

# ================================================
# OPTIONAL SETTINGS (defaults are usually fine)
# ================================================

# ElevenLabs voice selection (default: onyx)
ELEVENLABS_VOICE_ID=onyx

# Wake word sensitivity (0.0-1.0, default: 0.5)
WAKE_WORD_SENSITIVITY=0.5

# Your name for personalized responses
USER_NAME=Your Name Here
```

Replace each placeholder (`your_*_key_here`) with your actual API keys.

### Step 4: First Launch

1. **Launch Atlas**
   - Windows: Start menu > Atlas
   - macOS: Applications > Atlas
   - Linux: Run the AppImage

2. **Wait for Initialization**
   - The orb will appear in the center of your screen
   - It may take a few seconds for all services to initialize
   - The orb will gently rotate when ready

3. **Verify Services**
   - Check the system tray icon for Atlas
   - Look for any error notifications

### Step 5: Your First Conversation

Once Atlas is running:

1. **Activate Atlas**
   - Say: **"Hey Atlas"** (or your configured wake word)
   - The orb will pulse cyan to indicate it is listening

2. **Ask a Question**
   - Wait for the orb to indicate listening mode
   - Say: **"Hello, what can you help me with?"**

3. **Receive Response**
   - The orb will turn amber while thinking
   - Atlas will speak the response
   - The orb will turn green/blue while speaking

4. **Try More Commands**
   - "What time is it?"
   - "Tell me a joke"
   - "Search for the latest AI news"

---

## Understanding Atlas States

The orb visualization tells you what Atlas is doing:

| Orb Appearance | State | What to Do |
|---------------|-------|------------|
| Slow, gentle rotation | **Idle** | Say wake word or click to activate |
| Pulsing cyan, particles converge | **Listening** | Speak your request |
| Rapid rotation, amber glow | **Processing** | Wait for response |
| Expanding particles, green/blue | **Speaking** | Listen to response |
| Scattered particles, red | **Error** | Check logs or retry |

---

## Testing Your Setup

### Test 1: Wake Word Detection

1. Say "Hey Atlas" clearly
2. The orb should pulse cyan within 1-2 seconds
3. If no response, check:
   - Microphone is connected and selected
   - PORCUPINE_API_KEY is correct
   - Speak louder or increase sensitivity

### Test 2: Speech Recognition

1. Activate Atlas (wake word or click)
2. Say "What is two plus two?"
3. You should see the orb transition through states
4. If no response, check:
   - DEEPGRAM_API_KEY is correct (if using Deepgram)
   - Internet connection is working

### Test 3: Language Model

1. Activate Atlas
2. Ask "Tell me an interesting fact"
3. Atlas should respond with a fact
4. If no response, check:
   - FIREWORKS_API_KEY is correct
   - Check logs in `~/.atlas/logs/`

### Test 4: Text-to-Speech

1. The response from Test 3 should be spoken aloud
2. If no audio, check:
   - ELEVENLABS_API_KEY is correct (if using ElevenLabs)
   - Speaker volume is up
   - Correct audio output device is selected

---

## Common First-Time Issues

### "Atlas doesn't hear me"

1. **Check microphone selection**
   - Make sure Atlas is using the correct microphone
   - Test your mic in another application

2. **Increase wake word sensitivity**
   ```env
   WAKE_WORD_SENSITIVITY=0.7
   ```

3. **Reduce background noise**
   - Move to a quieter location
   - Close windows and doors

### "Atlas hears me but doesn't respond"

1. **Check your internet connection**
   - LLM requires internet access

2. **Verify API keys**
   - Make sure FIREWORKS_API_KEY is correct
   - Check for typos or extra spaces

3. **Check logs**
   - Look at `~/.atlas/logs/` for error messages

### "Atlas speaks but sounds robotic"

1. **Check ElevenLabs configuration**
   - Verify ELEVENLABS_API_KEY is set correctly
   - Atlas is falling back to system voice

2. **Try a different voice**
   ```env
   ELEVENLABS_VOICE_ID=rachel
   ```

### "The orb is laggy"

1. **Check GPU drivers**
   - Update your graphics drivers

2. **Reduce quality settings**
   - Lower particle count if available in settings

3. **Close other GPU-intensive applications**

---

## Next Steps

Now that Atlas is set up, explore these features:

### Try Different Voice Commands

- "Open Google in my browser"
- "What files are in this folder?"
- "Search for TypeScript tutorials"
- "Show me the git status"

See the [Voice Commands Reference](./voice-commands.md) for a complete list.

### Customize Your Experience

Edit your `.env` file to personalize Atlas:

```env
# Set your name
USER_NAME=Alex

# Adjust voice detection
WAKE_WORD_SENSITIVITY=0.6
VAD_SILENCE_DURATION=1200

# Change voice
ELEVENLABS_VOICE_ID=adam
```

### Explore Agent Tools

Atlas can help with many tasks:

- **File management:** Read, write, search files
- **Terminal:** Run shell commands
- **Git:** Manage repositories
- **Browser:** Open pages, take screenshots
- **Search:** Query the web

---

## Troubleshooting Resources

- **Logs:** `~/.atlas/logs/` - Check for error messages
- **User Guide:** [docs/USER-GUIDE.md](../USER-GUIDE.md) - Full documentation
- **FAQ:** [docs/USER-GUIDE.md#faq](../USER-GUIDE.md#faq) - Common questions
- **Issues:** GitHub issues for bug reports

---

## Quick Reference Card

### Activation Methods

| Method | Action |
|--------|--------|
| Wake word | Say "Hey Atlas" |
| Click | Click the orb |
| Push-to-talk | Hold `Ctrl+Space` |

### Essential Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Push-to-talk |
| `Ctrl+Shift+A` | Show/hide Atlas |
| `Ctrl+Shift+M` | Mute/unmute |
| `Escape` | Cancel operation |

### Common Voice Commands

| Request | Example Phrase |
|---------|----------------|
| Help | "What can you do?" |
| Time | "What time is it?" |
| Search | "Search for [topic]" |
| Files | "List files in [folder]" |
| Commands | "Run [command]" |
| Git | "Show git status" |

---

*You are now ready to use Atlas. Enjoy your new AI assistant!*
