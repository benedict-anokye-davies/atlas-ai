# ATLAS - Autonomous Task & Lifestyle Assistant System
## Comprehensive Product Requirements Document (PRD)

**Version**: 2.0
**Codename**: Atlas
**Status**: Complete Rebuild - AGNT-Style Architecture
**Target**: Full-Featured AI Agent Platform with Voice-First Interface

---

## Executive Summary

Atlas (formerly Nova) is a **voice-first, local-first AI agent platform** that combines the conversational interface of a personal assistant with the automation power of workflow engines like AGNT.gg. The central visual element is an interactive particle orb that serves as the primary interface, with panels that slide out for workflows, integrations, chat history, and settings.

### Name Options (Choose One)

| Name | Meaning | Vibe |
|------|---------|------|
| **Atlas** | Greek Titan who held up the heavens | Powerful, supportive, carries your world |
| **Aria** | Italian for "air" or musical melody | Light, musical, voice-focused |
| **Sage** | Wise advisor, aromatic herb | Intelligent, grounded, helpful |
| **Echo** | Sound reflection, Greek nymph | Voice-focused, responsive, memorable |
| **Orion** | Hunter constellation | Celestial, ambitious, guiding |
| **Nexus** | Connection point, center | Hub for all your digital life |

**Recommended**: **Atlas** - conveys the idea of an AI that "holds up" your digital world, supports you, and handles the weight of complex tasks.

---

## Table of Contents

1. [Vision & Goals](#vision--goals)
2. [User Personas](#user-personas)
3. [System Architecture](#system-architecture)
4. [Feature Specifications](#feature-specifications)
5. [Technical Stack](#technical-stack)
6. [Database Schema](#database-schema)
7. [API Contracts](#api-contracts)
8. [UI/UX Specifications](#uiux-specifications)
9. [Workstream Breakdown (4 Terminals)](#workstream-breakdown)
10. [Security Model](#security-model)
11. [Performance Requirements](#performance-requirements)
12. [Testing Strategy](#testing-strategy)
13. [Deployment & Distribution](#deployment--distribution)

---

## Vision & Goals

### Vision Statement

> "One AI that eventually has access to your entire digital life - bank accounts, passwords, devices, messages, diary, calendar, location, email, photos, health data, purchase history - all utilized in conjunction to drastically improve your life."

### Core Principles

1. **Voice-First**: The orb is always listening (after wake word), voice is the primary interaction mode
2. **Local-First**: All data stored locally, cloud services optional, full offline capability
3. **Proactive Intelligence**: Atlas anticipates needs, doesn't just respond to commands
4. **Human-Like Personality**: Witty, sarcastic, friendly companion - not a robotic assistant
5. **24/7 Workflows**: Background automation runs continuously even when UI is closed
6. **Full Life Integration**: Connect to every aspect of digital life

### Success Metrics

| Metric | Target |
|--------|--------|
| Wake-to-response time | <3 seconds |
| Orb framerate | 60fps on integrated graphics |
| Memory footprint | <600MB RAM |
| Daily active workflow success rate | >95% |
| User satisfaction (personality) | "Feels like talking to a friend" |

---

## User Personas

### Primary: Power User Developer
- Uses Atlas for coding assistance, git operations, research
- Wants voice control while hands are on keyboard
- Expects Atlas to remember project context across sessions
- Values wit and personality over pure efficiency

### Secondary: Productivity Enthusiast
- Uses Atlas for email management, calendar, task automation
- Wants proactive morning briefings
- Values workflow automation for repetitive tasks
- Appreciates being greeted by name

### Tertiary: Trader/Finance User
- Monitors crypto/stock prices via workflows
- Needs real-time alerts and notifications
- Values accuracy and speed over personality
- Uses Atlas for research and analysis

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ATLAS DESKTOP APP                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    RENDERER PROCESS (React)                  │    │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐   │    │
│  │  │   Orb   │  │ Workflow │  │  Chat   │  │   Settings   │   │    │
│  │  │  View   │  │  Canvas  │  │ History │  │    Panel     │   │    │
│  │  └─────────┘  └──────────┘  └─────────┘  └──────────────┘   │    │
│  │                                                              │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │              State Management (Zustand)              │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │ IPC │                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     MAIN PROCESS (Electron)                  │    │
│  │                                                              │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │    │
│  │  │    Voice     │  │   Workflow   │  │    Agent     │       │    │
│  │  │   Pipeline   │  │    Engine    │  │   Runtime    │       │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │    │
│  │                                                              │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │    │
│  │  │    Memory    │  │ Integration  │  │   Security   │       │    │
│  │  │    System    │  │   Manager    │  │    Layer     │       │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │    │
│  │                                                              │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │              MCP Protocol Layer                      │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                         BACKGROUND SERVICE                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  System Tray + Hidden Window (24/7 Workflow Execution)       │   │
│  │  • Workflow Scheduler (cron jobs)                             │   │
│  │  • Event Listeners (webhooks, triggers)                       │   │
│  │  • Integration Polling (email, calendar, prices)              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                          LOCAL SERVICES                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ LanceDB │  │ SQLite  │  │ Whisper │  │ Vosk    │  │ ComfyUI │   │
│  │ (Vector)│  │ (Meta)  │  │  (STT)  │  │ (STT)   │  │ (Image) │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                          CLOUD SERVICES                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │Fireworks│  │Deepgram │  │Eleven   │  │ Google  │  │ Discord │   │
│  │   AI    │  │  (STT)  │  │ Labs    │  │  APIs   │  │   Bot   │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
User Speaks → Wake Word (Porcupine) → VAD (Silero) → STT (Deepgram/Vosk)
                                                           ↓
                                                    Memory Context
                                                           ↓
                                                   LLM (Fireworks AI)
                                                           ↓
                                                    Tool Execution
                                                           ↓
                                                 TTS (ElevenLabs/Piper)
                                                           ↓
                                                      Audio Output
                                                           ↓
                                                    Orb Visualization
```

---

## Feature Specifications

### Module 1: Voice Pipeline (VOICE)

#### VOICE-001: Wake Word Detection
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Primary wake word | "Hey Atlas" (or chosen name) |
| Secondary wake words | "Computer", custom user-defined |
| Detection latency | <200ms |
| False positive rate | <1 per hour in quiet environment |
| Confidence threshold | Configurable 0.5-0.9, adaptive based on ambient noise |
| Visual feedback | Orb pulses cyan on detection |

**Implementation**:
- Porcupine SDK for wake word detection
- Custom .ppn model for "Hey Atlas"
- Ambient noise level tracking for adaptive thresholds
- Cooldown period (500ms) to prevent rapid re-triggers

#### VOICE-002: Voice Activity Detection (VAD)
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Engine | Silero VAD (87.7% accuracy at 5% FPR) |
| Silence timeout | Adaptive: 1.5s default, 3s for incomplete sentences |
| "Still listening" detection | Detects continuation words (and, but, because) |
| States | idle → listening → hearing → still_listening → processing |
| Interruption support | User can interrupt Atlas mid-response |

**Implementation**:
- Sentence completion detection using regex patterns
- Continuation word detection at end of transcript
- IPC events for listening state changes
- Barge-in detection to stop TTS mid-playback

#### VOICE-003: Speech-to-Text (STT)
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Primary provider | Deepgram Nova-3 |
| Fallback provider | Vosk (offline) or Whisper.cpp |
| Latency target | <300ms for interim results |
| Streaming | Real-time streaming transcription |
| Punctuation | Auto-punctuation enabled |

**Implementation**:
- WebSocket connection to Deepgram for streaming
- Interim results displayed in UI for feedback
- Automatic provider switching on failure
- GPU-accelerated Whisper.cpp for offline (small.en model)

#### VOICE-004: Text-to-Speech (TTS)
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Primary provider | ElevenLabs (streaming) |
| Fallback provider | Piper (local) or system voice |
| Voice personality | Configurable: warm, professional, playful |
| Latency target | <500ms to first audio |
| Interruption | Can be stopped mid-sentence |

**Implementation**:
- ElevenLabs WebSocket streaming for low latency
- Audio chunking for smooth playback
- Voice speed/stability controls
- Piper with pre-downloaded voice models for offline

#### VOICE-005: Barge-In & Interruption
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Detection | Wake word OR sustained speech during TTS |
| Action | Immediately stop TTS, switch to listening |
| Context preservation | Remember what Atlas was saying |
| User feedback | "I'll stop there. What did you want to say?" |

**Implementation**:
- Monitor audio input level during TTS playback
- Detect wake word even during playback (with ducking)
- Store interrupted response for potential continuation

#### VOICE-006: Push-to-Talk
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Hotkey | Configurable, default Ctrl+Space |
| Behavior | Hold to talk, release to process |
| Visual feedback | Orb turns green during PTT |
| Alternative | Can coexist with wake word |

---

### Module 2: Orb Visualization (ORB)

#### ORB-001: Particle System
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Particle count | Adaptive: 3,000-15,000 based on GPU capability |
| Attractor | Aizawa strange attractor (default), switchable |
| Rendering | Instanced rendering via Three.js InstancedMesh |
| Framerate target | 60fps on RTX 3060, 30fps on integrated |

**Implementation**:
- GPU detection on startup to set quality preset
- Dynamic LOD system based on FPS monitoring
- Quality presets: Low (3K), Medium (8K), High (12K), Ultra (20K)

#### ORB-002: State-Based Animations
**Priority**: P0 (Critical)

| State | Visual Behavior |
|-------|-----------------|
| **Idle** | Slow, gentle particle rotation, dim glow |
| **Listening** | Particles converge inward, pulsing cyan |
| **Thinking** | Rapid rotation, particles spiral, yellow/amber glow |
| **Speaking** | Particles expand outward with audio amplitude, green/blue |
| **Error** | Particles scatter chaotically, red pulses |
| **Working** | Particles form progress ring, amber |

#### ORB-003: Audio Reactivity
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Input source | TTS audio output stream |
| Analysis | FFT frequency analysis (bass/mid/treble) |
| Response | Particle scale/color responds to frequency bands |
| Latency | <16ms (one frame at 60fps) |

**Implementation**:
- Web Audio API AnalyserNode in renderer
- Real FFT data passed to shader uniforms
- Smooth interpolation to prevent jitter

#### ORB-004: Mouse Interaction
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Hover | Particles gently repel from cursor |
| Click | Activates listening mode (alternative to wake word) |
| Drag | Rotates camera view around orb |
| Double-click | Opens quick command palette |

#### ORB-005: Panel Transitions
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Default | Orb centered in window |
| Panel open | Orb smoothly transitions to corner |
| Animation | 300ms ease-out transition |
| Panels | Left (history), Right (workflows/integrations), Bottom (chat input) |

---

### Module 3: Memory System (MEM)

#### MEM-001: Conversation Memory
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Storage | LanceDB for vector embeddings |
| Retention | 30-90 days default, "remember forever" on command |
| Context assembly | Top-K semantic search + recency weighting |
| Capacity | Last 50 conversation turns in active context |

**Implementation**:
- Fireworks AI embeddings for semantic indexing
- Hybrid search: vector similarity + keyword matching
- Automatic importance scoring for retention decisions

#### MEM-002: User Facts & Preferences
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Extraction | Automatic from conversations |
| Categories | Personal info, preferences, decisions, relationships |
| Retrieval | Injected into LLM context when relevant |
| Examples | "User's name is X", "User prefers Y", "User works at Z" |

**Pattern Recognition**:
```
"I like X" → Preference (positive)
"I hate X" → Preference (negative)
"I work at X" → Personal fact
"My birthday is X" → Personal fact (high importance)
"Remember that X" → Explicit memory (permanent)
```

#### MEM-003: Proactive Memory Usage
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Behavior | Atlas references past conversations naturally |
| Example | "Oh, like when you told me about X last week..." |
| Trigger | Semantic similarity to past conversations |
| Frequency | Not every response - feels natural, not robotic |

#### MEM-004: Memory Consolidation
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Process | Nightly consolidation of similar memories |
| Summarization | LLM-based summarization of conversation chunks |
| Pruning | Remove low-importance memories after 90 days |
| User control | "Forget about X", "What do you remember about X?" |

#### MEM-005: Incognito Mode
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Activation | Voice command or toggle in settings |
| Behavior | No conversation logging, no memory updates |
| Indicator | Orb has subtle mask/privacy icon overlay |
| Scope | Until explicitly turned off |

---

### Module 4: LLM Integration (LLM)

#### LLM-001: Primary Model - Fireworks AI
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Primary model | DeepSeek V3.1 (671B params, 37B active) |
| Context window | 164K tokens |
| Streaming | Required for natural conversation feel |
| Cost target | <$0.01 per typical interaction |

**Implementation**:
- OpenAI-compatible SDK with Fireworks base URL
- Streaming responses for real-time TTS input
- System prompt includes personality + user context + memory

#### LLM-002: Model Routing
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Simple queries | DeepSeek V3.1 (fast, cheap) |
| Math/reasoning | Qwen3-235B or Kimi K2 |
| Long context | Qwen3-235B (256K context) |
| Fallback | OpenRouter → Local Ollama |

**Routing Logic**:
```typescript
function selectModel(query: string, context: Context): Model {
  if (context.tokenCount > 150000) return 'qwen3-235b';
  if (query.requiresDeepReasoning()) return 'kimi-k2';
  if (query.isMathHeavy()) return 'qwen3-235b';
  return 'deepseek-v3.1';
}
```

#### LLM-003: Personality System
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Default personality | Friendly companion, witty, slightly sarcastic |
| Traits | Configurable: friendliness, formality, humor, energy |
| Mood awareness | Adapts to user's detected sentiment |
| Error handling | Self-deprecating humor when mistakes happen |

**System Prompt Template**:
```
You are Atlas, a witty and caring AI companion. You are:
- Friendly and warm, but with a playful edge
- Occasionally sarcastic (in a loving way)
- Proactive in offering help without being pushy
- Honest about your limitations with humor
- You remember past conversations and reference them naturally

User's name: {user_name}
Current time: {timestamp}
User's mood: {detected_sentiment}
Recent context: {memory_context}

When you make mistakes, acknowledge them with humor like a friend would.
```

#### LLM-004: Tool Calling
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Format | OpenAI function calling format |
| Available tools | File system, browser, terminal, git, search, screen capture |
| Confirmation | Dangerous operations require user approval |
| Chaining | Multi-step tool usage supported |

#### LLM-005: Fine-Tuning Support
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Method | Fireworks SFT + RFT |
| Data collection | User can opt-in to training data collection |
| Custom model | Deploy fine-tuned model as "your Atlas" |
| Personality persistence | Fine-tuned personality traits |

---

### Module 5: Workflow Engine (FLOW)

#### FLOW-001: Workflow Definition
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Format | JSON-based workflow definition |
| Components | Triggers, Conditions, Actions, Outputs |
| Visual editor | React Flow-based canvas |
| Voice creation | "Create a workflow that..." |

**Workflow Schema**:
```typescript
interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  conditions?: Condition[];
  actions: Action[];
  errorHandling: ErrorConfig;
  schedule?: CronSchedule;
}

type Trigger =
  | { type: 'webhook'; url: string }
  | { type: 'schedule'; cron: string }
  | { type: 'event'; event: string; source: string }
  | { type: 'price_alert'; symbol: string; condition: string; value: number }
  | { type: 'email'; filter: EmailFilter }
  | { type: 'voice'; command: string };
```

#### FLOW-002: Pre-Built Workflow Templates
**Priority**: P1 (High)

| Template | Description |
|----------|-------------|
| **Price Alert** | Monitor crypto/stock prices, alert on threshold |
| **Email Scanner** | Scan emails, summarize important ones |
| **Daily Briefing** | Morning summary of calendar, weather, news |
| **GitHub Monitor** | Watch repos for new issues/PRs |
| **Discord Relay** | Forward important Discord messages |
| **Backup Reminder** | Daily backup prompts |
| **Meeting Prep** | Prepare notes before calendar events |

#### FLOW-003: Voice-Created Workflows
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Trigger | "Create a workflow that monitors Bitcoin..." |
| Process | LLM generates workflow JSON from description |
| Confirmation | "I'll create a workflow that does X. Sound good?" |
| Editing | "Change the threshold to Y" |

#### FLOW-004: Action Recording (Workflow by Example)
**Priority**: P2 (Medium)

| Requirement | Specification |
|-------------|---------------|
| Trigger | "Watch what I do and create a workflow" |
| Recording | Captures screen actions, clicks, navigation |
| Generalization | LLM converts recording to parameterized workflow |
| Confirmation | User reviews and approves generated workflow |

#### FLOW-005: 24/7 Background Execution
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Process | Hidden Electron window + system tray |
| Persistence | Survives app restart, system sleep |
| Scheduling | Node-cron for time-based triggers |
| Monitoring | Dashboard shows active workflows, last run, status |

**Implementation**:
```typescript
// System tray pattern for 24/7 operation
app.on('window-all-closed', (e) => {
  e.preventDefault(); // Don't quit, keep running in tray
});

const tray = new Tray(icon);
tray.setContextMenu(Menu.buildFromTemplate([
  { label: 'Show Atlas', click: () => mainWindow.show() },
  { label: 'Active Workflows', submenu: workflowsMenu },
  { label: 'Quit', click: () => app.quit() }
]));
```

#### FLOW-006: Conditional Logic
**Priority**: P1 (High)

| Requirement | Specification |
|-------------|---------------|
| Operators | ==, !=, >, <, >=, <=, contains, matches |
| Logic | AND, OR, NOT combinations |
| Variables | Access to trigger data, previous action outputs |
| Branching | If/else paths in workflow |

---

### Module 6: Integrations (INT)

#### INT-001: MCP Protocol Support
**Priority**: P0 (Critical)

| Requirement | Specification |
|-------------|---------------|
| Role | Atlas acts as MCP Client |
| Tool servers | Each integration can be an MCP Server |
| Discovery | Auto-discover available MCP servers |
| Authentication | OAuth resource server pattern |

#### INT-002: Core Integrations (Built-In)

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **File System** | P0 | Read, write, search, watch files |
| **Terminal** | P0 | Execute commands, capture output |
| **Browser** | P0 | Playwright automation, screenshot |
| **Git** | P0 | All git operations, AI conflict resolution |
| **Web Search** | P0 | Google, Bing, DuckDuckGo |
| **Screen Capture** | P1 | Screenshot, OCR, element detection |
| **Clipboard** | P1 | Read/write clipboard |

#### INT-003: Communication Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Gmail** | P0 | Read, send, label, search emails |
| **Google Calendar** | P0 | Read, create, modify events |
| **Outlook** | P1 | Email + Calendar via Microsoft Graph |
| **Discord** | P1 | Bot integration, message monitoring |
| **Slack** | P2 | Workspace integration |
| **SMS/iMessage** | P3 | Via system APIs where available |

#### INT-004: Finance Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Crypto Prices** | P1 | Binance WebSocket, CoinGecko REST |
| **Stock Prices** | P2 | Yahoo Finance, Alpha Vantage |
| **Portfolio Tracking** | P2 | Manual input + API connections |

#### INT-005: Productivity Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Notion** | P2 | Read/write pages, databases |
| **Todoist** | P2 | Task management |
| **Linear** | P2 | Issue tracking |
| **GitHub** | P1 | Issues, PRs, repos |

#### INT-006: Smart Home Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Home Assistant** | P2 | Full control via WebSocket API |
| **Philips Hue** | P2 | Light control |
| **Smart plugs** | P3 | On/off control |

#### INT-007: Media Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Spotify** | P2 | Playback control, recommendations |
| **YouTube** | P2 | Search, summarize videos |

#### INT-008: Health Integrations

| Integration | Priority | Capabilities |
|-------------|----------|--------------|
| **Apple Health** | P3 | Read health data (macOS only) |
| **Fitbit** | P3 | Activity, sleep data |

---

### Module 7: Agent Tools (TOOL)

#### TOOL-001: File System Agent
**Priority**: P0 (Critical)

| Capability | Description |
|------------|-------------|
| Read | Read file contents, with size limits |
| Write | Create/overwrite files |
| Search | Glob patterns, content search |
| Watch | Monitor directories for changes |
| Permissions | Sandboxed to user-approved directories |

#### TOOL-002: Browser Agent
**Priority**: P0 (Critical)

| Capability | Description |
|------------|-------------|
| Navigation | Open URLs, click, scroll |
| Form filling | Input text, select options |
| Screenshot | Capture page or element |
| Extraction | Read page content, DOM analysis |
| Anti-detection | Stealth techniques for automation |

**Implementation**:
- Playwright with persistent browser context
- Session cookies saved for authenticated sites
- Human-like delays and mouse movements
- Screenshot → LLM → Action loop for complex navigation

#### TOOL-003: Terminal Agent
**Priority**: P0 (Critical)

| Capability | Description |
|------------|-------------|
| Execute | Run shell commands |
| Capture | Stream stdout/stderr |
| PTY | Interactive terminal support |
| Timeout | Configurable command timeout |
| Safety | Dangerous command confirmation |

#### TOOL-004: Screen Analysis Agent
**Priority**: P1 (High)

| Capability | Description |
|------------|-------------|
| Screenshot | Capture current screen(s) |
| OCR | Extract text from images |
| Element detection | Find UI elements for automation |
| Multi-monitor | Aware of multiple displays |

#### TOOL-005: Code Execution Agent
**Priority**: P1 (High)

| Capability | Description |
|------------|-------------|
| Languages | Python, JavaScript, TypeScript, Shell |
| Sandbox | Isolated execution environment |
| Output | Capture return values, stdout |
| Timeout | Prevent infinite loops |

#### TOOL-006: Image Generation
**Priority**: P2 (Medium)

| Capability | Description |
|------------|-------------|
| Provider | DALL-E 3, Flux, local SDXL |
| Trigger | "Generate an image of..." |
| Quality tiers | Fast (Flux Schnell) vs Quality (DALL-E 3) |

#### TOOL-007: Document Analysis
**Priority**: P1 (High)

| Capability | Description |
|------------|-------------|
| PDF parsing | Extract text, tables, images |
| RAG | Index documents for semantic search |
| Summarization | LLM-based document summaries |

---

### Module 8: User Interface (UI)

#### UI-001: Main Window Layout
**Priority**: P0 (Critical)

```
┌─────────────────────────────────────────────────────────────────┐
│  [≡] Atlas                              [─] [□] [×]             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐                              ┌─────────────────┐   │
│  │ History │                              │ Active Workflows│   │
│  │         │                              │                 │   │
│  │ • Chat 1│         ┌───────┐           │ • BTC Alert ✓   │   │
│  │ • Chat 2│         │       │           │ • Email Scan ✓  │   │
│  │ • Chat 3│         │  ORB  │           │ • Daily Brief ✓ │   │
│  │         │         │       │           │                 │   │
│  │         │         └───────┘           │ Integrations    │   │
│  │         │                              │ • Gmail ✓       │   │
│  │         │                              │ • Calendar ✓    │   │
│  │         │                              │ • Discord ✓     │   │
│  └─────────┘                              └─────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [🎤] Type or speak...                           [⚙️] [?]    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### UI-002: Orb States & Positions

| State | Orb Position | Panels |
|-------|--------------|--------|
| Idle | Center | All collapsed |
| Listening | Center, pulsing | All collapsed |
| Chatting | Left-center | Right panel open (context) |
| Workflows | Top-left corner | Workflow canvas fills window |
| Settings | Top-left corner | Settings panel fills window |

#### UI-003: Dark Theme
**Priority**: P0 (Critical)

| Element | Color |
|---------|-------|
| Background | #0a0a0f |
| Surface | #12121a |
| Border | #1e1e2e |
| Text primary | #e0e0e0 |
| Text secondary | #888888 |
| Accent (Atlas) | #00d4aa (cyan-teal) |
| Warning | #f59e0b |
| Error | #ef4444 |
| Success | #22c55e |

#### UI-004: Panels

| Panel | Content | Trigger |
|-------|---------|---------|
| **Left - History** | Past conversations, saved outputs | Click hamburger or "Show history" |
| **Right - Workflows** | Active workflows, integrations | Click workflow icon or "Show workflows" |
| **Right - Settings** | All configuration options | Click gear icon or "Open settings" |
| **Bottom - Chat** | Text input, suggestions | Always visible (collapsed when orb listening) |

#### UI-005: System Tray
**Priority**: P1 (High)

| Menu Item | Action |
|-----------|--------|
| Show Atlas | Bring window to front |
| Quick Command | Open mini command palette |
| Active Workflows | Submenu with workflow status |
| Pause All | Pause all workflow execution |
| Mute | Disable audio output |
| Settings | Open settings panel |
| Quit | Exit application completely |

#### UI-006: Notifications
**Priority**: P1 (High)

| Type | Behavior |
|------|----------|
| Workflow alert | Native OS notification + optional TTS |
| Email summary | Toast notification with preview |
| Price alert | Native notification with current price |
| Error | Toast in-app + optional native |
| Daily briefing | Full modal or TTS based on preference |

---

### Module 9: Onboarding (ONBOARD)

#### ONBOARD-001: First Launch Experience
**Priority**: P1 (High)

**Flow**:
1. Welcome screen with Atlas orb animation
2. Name input: "What should I call you?"
3. Voice selection: Preview different voice styles
4. API key setup wizard (with links to get keys)
5. Microphone test with visualization
6. Quick tutorial: "Say 'Hey Atlas' to begin"
7. First conversation: Atlas greets by name

#### ONBOARD-002: API Key Setup
**Priority**: P0 (Critical)

| Service | Required | Setup Help |
|---------|----------|------------|
| Fireworks AI | Yes | Link to console, free tier info |
| Deepgram | No (fallback available) | Link, free tier info |
| ElevenLabs | No (fallback available) | Link, free tier info |
| Porcupine | Yes | Link to Picovoice console |

#### ONBOARD-003: Personalization
**Priority**: P1 (High)

| Setting | Options |
|---------|---------|
| User name | Text input |
| Atlas personality | Sliders: Friendly ↔ Professional, Witty ↔ Serious |
| Voice style | Dropdown with previews |
| Wake word | Default + custom option |
| Quality preset | Auto-detect or manual |

---

### Module 10: Settings (SET)

#### SET-001: General Settings

| Setting | Type | Default |
|---------|------|---------|
| User name | Text | (from onboarding) |
| Start with system | Toggle | true |
| Start minimized | Toggle | false |
| Language | Dropdown | English |
| Theme | Dropdown | Dark (only option initially) |

#### SET-002: Voice Settings

| Setting | Type | Default |
|---------|------|---------|
| Wake word enabled | Toggle | true |
| Wake word sensitivity | Slider 0.5-0.9 | 0.7 |
| Input device | Dropdown | System default |
| Output device | Dropdown | System default |
| Push-to-talk hotkey | Key capture | Ctrl+Space |
| Voice speed | Slider 0.5-2.0 | 1.0 |

#### SET-003: Personality Settings

| Setting | Type | Default |
|---------|------|---------|
| Friendliness | Slider 0-1 | 0.9 |
| Formality | Slider 0-1 | 0.3 |
| Humor | Slider 0-1 | 0.7 |
| Proactiveness | Slider 0-1 | 0.6 |
| Preset | Dropdown | Atlas Default |

#### SET-004: Privacy Settings

| Setting | Type | Default |
|---------|------|---------|
| Memory enabled | Toggle | true |
| Memory retention | Dropdown | 90 days |
| Incognito mode | Toggle | false |
| Analytics | Toggle | false |
| Export data | Button | - |
| Delete all data | Button | - |

#### SET-005: Visual Settings

| Setting | Type | Default |
|---------|------|---------|
| Quality preset | Dropdown | Auto |
| Particle count | Slider (if manual) | 8000 |
| Post-processing | Toggle | true |
| Attractor type | Dropdown | Aizawa |

#### SET-006: Integration Settings

| Integration | Configure | Status |
|-------------|-----------|--------|
| Gmail | OAuth connect | Connected/Not connected |
| Calendar | OAuth connect | Connected/Not connected |
| Discord | Bot token input | Connected/Not connected |
| (etc.) | ... | ... |

#### SET-007: Workflow Settings

| Setting | Type | Default |
|---------|------|---------|
| Run on startup | Toggle | true |
| Notification style | Dropdown | Toast + TTS |
| Max concurrent | Number | 5 |
| Retry on failure | Toggle | true |
| Retry count | Number | 3 |

---

## Technical Stack

### Core Technologies

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Electron | 30+ | Cross-platform desktop |
| Frontend | React | 19 | UI components |
| Language | TypeScript | 5.4+ | Type safety |
| 3D | React Three Fiber | 8+ | Orb visualization |
| State | Zustand | 4+ | Global state management |
| Workflow UI | React Flow | 12+ | Visual workflow editor |
| Build | Vite | 5+ | Fast builds, HMR |
| Package | electron-builder | 24+ | Distribution |
| Testing | Vitest | 1+ | Unit/integration tests |
| E2E | Playwright | 1.40+ | End-to-end tests |

### Backend Services

| Service | Technology | Purpose |
|---------|------------|---------|
| Vector DB | LanceDB | Semantic memory search |
| Metadata DB | SQLite | Structured data, settings |
| Queue | Bull (Redis optional) | Workflow job queue |
| Cron | node-cron | Scheduled workflows |

### External APIs

| Service | Purpose | Fallback |
|---------|---------|----------|
| Fireworks AI | LLM inference | OpenRouter → Ollama |
| Deepgram | Speech-to-text | Vosk → Whisper.cpp |
| ElevenLabs | Text-to-speech | Piper → System voice |
| Porcupine | Wake word | (required) |

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4-core | 6-core |
| RAM | 8GB | 16GB |
| GPU | Integrated | 4GB+ VRAM |
| Storage | 2GB app + 5GB data | 10GB+ |
| Network | Required for cloud | Optional for offline |

---

## Database Schema

### LanceDB Tables (Vector)

```typescript
// Memory embeddings
interface MemoryEmbedding {
  id: string;
  embedding: Float32Array; // 1536 dimensions
  content: string;
  type: 'conversation' | 'fact' | 'preference' | 'document';
  importance: number; // 0-1
  timestamp: number;
  metadata: {
    topics: string[];
    sentiment: string;
    source: string;
  };
}

// Document embeddings
interface DocumentEmbedding {
  id: string;
  embedding: Float32Array;
  content: string;
  documentId: string;
  chunkIndex: number;
  metadata: {
    filename: string;
    page?: number;
    heading?: string;
  };
}
```

### SQLite Tables (Metadata)

```sql
-- User settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);

-- Conversations
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  message_count INTEGER
);

-- Messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT, -- 'user' | 'assistant'
  content TEXT,
  timestamp INTEGER,
  tool_calls TEXT, -- JSON
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Workflows
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  definition TEXT, -- JSON
  enabled INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  last_run INTEGER,
  run_count INTEGER,
  error_count INTEGER
);

-- Workflow runs
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  status TEXT, -- 'success' | 'error' | 'running'
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT, -- JSON
  error TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

-- Integrations
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  type TEXT, -- 'gmail', 'calendar', etc.
  config TEXT, -- JSON (encrypted)
  status TEXT, -- 'connected' | 'disconnected' | 'error'
  last_sync INTEGER,
  created_at INTEGER
);

-- User facts (extracted from conversations)
CREATE TABLE user_facts (
  id TEXT PRIMARY KEY,
  category TEXT, -- 'personal', 'preference', 'work', 'relationship'
  key TEXT,
  value TEXT,
  confidence REAL,
  source_message_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
```

---

## API Contracts

### IPC Channels (Main ↔ Renderer)

```typescript
// Voice events
'atlas:wake-detected': { confidence: number; timestamp: number }
'atlas:listening-state': { state: ListeningState }
'atlas:transcript': { text: string; isFinal: boolean }
'atlas:response-start': { }
'atlas:response-chunk': { text: string }
'atlas:response-end': { fullText: string }
'atlas:tts-audio': { dataUrl: string }
'atlas:error': { code: string; message: string }

// Workflow events
'atlas:workflow-status': { workflowId: string; status: string }
'atlas:workflow-alert': { workflowId: string; message: string; data: any }

// System events
'atlas:online-status': { isOnline: boolean }
'atlas:service-status': { service: string; status: string }
```

### Internal Service Interfaces

```typescript
// STT Provider Interface
interface STTProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  onTranscript(callback: (text: string, isFinal: boolean) => void): void;
  onError(callback: (error: Error) => void): void;
}

// TTS Provider Interface
interface TTSProvider {
  speak(text: string): Promise<void>;
  stop(): void;
  setVoice(voiceId: string): void;
  setSpeed(speed: number): void;
  onStart(callback: () => void): void;
  onEnd(callback: () => void): void;
  onAudioData(callback: (chunk: Buffer) => void): void;
}

// LLM Provider Interface
interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<string>;
  generateEmbedding(text: string): Promise<number[]>;
}

// Memory Provider Interface
interface MemoryProvider {
  store(memory: MemoryItem): Promise<void>;
  search(query: string, limit?: number): Promise<MemoryItem[]>;
  getContext(query: string): Promise<string>;
  forget(memoryId: string): Promise<void>;
}

// Workflow Engine Interface
interface WorkflowEngine {
  register(workflow: Workflow): void;
  unregister(workflowId: string): void;
  execute(workflowId: string, triggerData?: any): Promise<WorkflowResult>;
  getStatus(workflowId: string): WorkflowStatus;
  pause(workflowId: string): void;
  resume(workflowId: string): void;
}
```

---

## Workstream Breakdown

### Terminal 1: CORE (Voice + LLM + Memory)

**Focus**: The "brain" of Atlas - voice pipeline, LLM integration, and memory system.

**Owner**: Terminal 1

**Scope**:
- Voice pipeline (wake word, VAD, STT, TTS)
- LLM integration (Fireworks, routing, personality)
- Memory system (LanceDB, embeddings, retrieval)
- Conversation management

**Key Files**:
```
src/main/voice/
src/main/stt/
src/main/tts/
src/main/llm/
src/main/memory/
```

**Dependencies**: None (foundational)

**Deliverables**:
1. Complete voice pipeline with interruption support
2. Multi-model LLM routing
3. Semantic memory with proactive retrieval
4. Personality system with mood awareness

---

### Terminal 2: FLOW (Workflows + Integrations)

**Focus**: Background automation engine and external service integrations.

**Owner**: Terminal 2

**Scope**:
- Workflow engine (execution, scheduling, monitoring)
- Workflow canvas UI (React Flow)
- Integration framework (MCP protocol)
- OAuth flows for external services
- Pre-built workflow templates

**Key Files**:
```
src/main/workflow/
src/main/integrations/
src/renderer/components/workflow/
```

**Dependencies**: CORE (LLM for voice-created workflows)

**Deliverables**:
1. 24/7 workflow execution engine
2. Visual workflow editor
3. 10+ pre-built workflow templates
4. OAuth integration framework
5. Core integrations (Gmail, Calendar, Discord)

---

### Terminal 3: ORB (Visualization + UI)

**Focus**: The visual interface - orb, panels, settings, onboarding.

**Owner**: Terminal 3

**Scope**:
- Orb visualization (particles, animations, audio reactivity)
- Panel system (history, workflows, settings)
- Settings UI
- Onboarding wizard
- System tray
- Notifications

**Key Files**:
```
src/renderer/components/orb/
src/renderer/components/panels/
src/renderer/components/settings/
src/renderer/components/onboarding/
src/main/tray/
```

**Dependencies**: CORE (state updates), FLOW (workflow status)

**Deliverables**:
1. 60fps orb with state animations
2. Audio-reactive particles
3. Sliding panel system
4. Complete settings UI
5. First-run onboarding
6. System tray with status

---

### Terminal 4: TOOLS (Agent Capabilities + Testing)

**Focus**: Agent tools, browser automation, code execution, and testing infrastructure.

**Owner**: Terminal 4

**Scope**:
- Agent tools (file system, terminal, browser, git)
- Screen capture and OCR
- Code execution sandbox
- Image generation integration
- Document analysis (PDF/RAG)
- Testing infrastructure
- E2E tests

**Key Files**:
```
src/main/agent/tools/
src/main/agent/sandbox/
src/main/agent/browser/
tests/
```

**Dependencies**: CORE (LLM for tool calling), ORB (UI for confirmations)

**Deliverables**:
1. Complete agent tool suite
2. Browser automation with stealth
3. Code execution sandbox
4. Document RAG pipeline
5. 80%+ test coverage
6. E2E test suite

---

## Security Model

### Data Security

| Data Type | Storage | Encryption |
|-----------|---------|------------|
| API keys | Electron safeStorage | OS keychain |
| OAuth tokens | Electron safeStorage | OS keychain |
| Conversation logs | SQLite | Optional at-rest encryption |
| Memory embeddings | LanceDB | None (local only) |
| Settings | JSON file | None (non-sensitive) |

### Permission Model

| Operation | Permission Required |
|-----------|---------------------|
| File read/write | First-time directory approval |
| Terminal command | Confirmation for dangerous commands |
| Browser automation | None (sandboxed) |
| Send email | Confirmation per action |
| Calendar modify | Confirmation per action |
| Purchase/payment | Always blocked (user must do manually) |

### Dangerous Command Detection

```typescript
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /format\s+[a-z]:/i,
  /del\s+\/[fsq]/i,
  /mkfs/,
  /dd\s+if=/,
  /> \/dev\/sd/,
];

function requiresConfirmation(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}
```

---

## Performance Requirements

### Latency Targets

| Operation | Target | Maximum |
|-----------|--------|---------|
| Wake word detection | 150ms | 200ms |
| STT streaming (interim) | 200ms | 300ms |
| LLM first token | 1.5s | 2.5s |
| TTS first audio | 400ms | 600ms |
| Total wake-to-response | 2.5s | 4s |
| Orb frame time | 16ms (60fps) | 33ms (30fps) |
| Panel animation | 300ms | 500ms |
| Workflow trigger-to-action | 500ms | 2s |

### Resource Limits

| Resource | Target | Maximum |
|----------|--------|---------|
| RAM (idle) | 300MB | 400MB |
| RAM (active) | 500MB | 700MB |
| CPU (idle) | <2% | 5% |
| CPU (listening) | <15% | 25% |
| GPU (orb) | <30% | 50% |
| Disk (app) | 500MB | 1GB |
| Disk (data) | 2GB | 10GB |

### Startup Performance

| Phase | Target |
|-------|--------|
| Window visible | 1s |
| Orb rendered | 2s |
| Voice ready | 3s |
| Workflows started | 5s |
| Full ready | 5s |

---

## Testing Strategy

### Unit Tests

| Module | Coverage Target |
|--------|-----------------|
| Voice pipeline | 80% |
| LLM integration | 75% |
| Memory system | 85% |
| Workflow engine | 85% |
| Agent tools | 80% |
| Integrations | 70% |

### Integration Tests

| Test | Description |
|------|-------------|
| Voice flow | Wake → STT → LLM → TTS |
| Memory retrieval | Store → Query → Inject |
| Workflow execution | Trigger → Conditions → Actions |
| Tool calling | LLM → Tool → Response |

### E2E Tests

| Test | Description |
|------|-------------|
| First launch | Onboarding flow complete |
| Voice conversation | Full voice interaction |
| Workflow creation | Voice-create → Execute |
| Settings change | Modify → Persist → Apply |

---

## Deployment & Distribution

### Build Targets

| Platform | Format | Signing |
|----------|--------|---------|
| Windows | NSIS installer, portable | Code signing certificate |
| macOS | DMG, pkg | Apple Developer ID |
| Linux | AppImage, deb, rpm | None |

### Auto-Update

| Feature | Implementation |
|---------|----------------|
| Check frequency | On startup + every 24h |
| Download | Background, delta updates |
| Install | Prompt user, apply on restart |
| Rollback | Keep previous version |

### Distribution Channels

| Channel | Purpose |
|---------|---------|
| GitHub Releases | Primary distribution |
| Direct download | Website |
| Microsoft Store | Optional (Windows) |
| Homebrew | Optional (macOS) |

---

## Appendix A: File Structure

```
atlas-desktop/
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts               # Entry point
│   │   ├── preload.ts             # Preload script
│   │   ├── config/                # Configuration
│   │   ├── voice/                 # Voice pipeline
│   │   │   ├── wake-word.ts
│   │   │   ├── vad.ts
│   │   │   ├── pipeline.ts
│   │   │   └── audio-preprocessor.ts
│   │   ├── stt/                   # Speech-to-text
│   │   │   ├── manager.ts
│   │   │   ├── deepgram.ts
│   │   │   ├── vosk.ts
│   │   │   └── whisper.ts
│   │   ├── tts/                   # Text-to-speech
│   │   │   ├── manager.ts
│   │   │   ├── elevenlabs.ts
│   │   │   └── piper.ts
│   │   ├── llm/                   # LLM integration
│   │   │   ├── manager.ts
│   │   │   ├── fireworks.ts
│   │   │   ├── router.ts
│   │   │   └── personality.ts
│   │   ├── memory/                # Memory system
│   │   │   ├── manager.ts
│   │   │   ├── embeddings.ts
│   │   │   ├── vector-store/
│   │   │   │   └── lancedb.ts
│   │   │   ├── conversation.ts
│   │   │   └── facts.ts
│   │   ├── workflow/              # Workflow engine
│   │   │   ├── engine.ts
│   │   │   ├── scheduler.ts
│   │   │   ├── triggers/
│   │   │   ├── actions/
│   │   │   └── templates/
│   │   ├── integrations/          # External integrations
│   │   │   ├── manager.ts
│   │   │   ├── mcp/
│   │   │   ├── gmail/
│   │   │   ├── calendar/
│   │   │   ├── discord/
│   │   │   └── crypto/
│   │   ├── agent/                 # Agent tools
│   │   │   ├── tools/
│   │   │   │   ├── filesystem.ts
│   │   │   │   ├── terminal.ts
│   │   │   │   ├── browser.ts
│   │   │   │   ├── git.ts
│   │   │   │   └── screen.ts
│   │   │   ├── sandbox/
│   │   │   └── llm-tools.ts
│   │   ├── tray/                  # System tray
│   │   ├── ipc/                   # IPC handlers
│   │   ├── security/              # Security layer
│   │   └── utils/                 # Utilities
│   │
│   ├── renderer/                  # React frontend
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── orb/               # Orb visualization
│   │   │   │   ├── AtlasOrb.tsx
│   │   │   │   ├── particles/
│   │   │   │   └── shaders/
│   │   │   ├── panels/            # UI panels
│   │   │   │   ├── HistoryPanel.tsx
│   │   │   │   ├── WorkflowPanel.tsx
│   │   │   │   └── SettingsPanel.tsx
│   │   │   ├── workflow/          # Workflow canvas
│   │   │   │   ├── Canvas.tsx
│   │   │   │   ├── nodes/
│   │   │   │   └── edges/
│   │   │   ├── chat/              # Chat interface
│   │   │   ├── settings/          # Settings UI
│   │   │   ├── onboarding/        # Onboarding wizard
│   │   │   └── common/            # Shared components
│   │   ├── hooks/                 # React hooks
│   │   ├── stores/                # Zustand stores
│   │   └── styles/                # CSS/styling
│   │
│   └── shared/                    # Shared types
│       └── types/
│
├── tests/                         # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── assets/                        # Static assets
│   ├── icons/
│   ├── models/                    # Wake word models
│   └── voices/                    # Offline TTS voices
│
├── docs/                          # Documentation
│
└── scripts/                       # Build scripts
```

---

## Appendix B: Environment Variables

```env
# Required
FIREWORKS_API_KEY=           # Fireworks AI API key
PORCUPINE_API_KEY=           # Picovoice wake word key

# Optional (with fallbacks)
DEEPGRAM_API_KEY=            # Deepgram STT (fallback: Vosk)
ELEVENLABS_API_KEY=          # ElevenLabs TTS (fallback: Piper)
OPENROUTER_API_KEY=          # OpenRouter fallback LLM

# Integrations (user adds via UI)
GOOGLE_CLIENT_ID=            # Gmail/Calendar OAuth
GOOGLE_CLIENT_SECRET=
DISCORD_BOT_TOKEN=           # Discord integration
```

---

## Appendix C: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Space | Push-to-talk (hold) |
| Ctrl+Shift+A | Toggle Atlas window |
| Ctrl+Shift+M | Toggle mute |
| Escape | Cancel current operation |
| Ctrl+, | Open settings |
| Ctrl+H | Toggle history panel |
| Ctrl+W | Toggle workflows panel |
| Ctrl+N | New conversation |

---

**Document Version**: 2.0
**Last Updated**: 2026-01-15
**Author**: Atlas Development Team
