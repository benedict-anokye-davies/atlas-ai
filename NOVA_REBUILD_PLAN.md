# NOVA REBUILD PLAN
## Voice-First Desktop AI Assistant with Strange Attractor Visual Interface

**Version**: 2.0  
**Created**: January 13, 2026  
**Status**: Ready for Implementation  
**Target Completion**: Phase 1 by January 16, 2026 (MVP before exams)

---

## EXECUTIVE SUMMARY

Transform Nova from a web-based multi-agent council into a **unified desktop AI assistant** powering your trading bot, development workflow, and self-learning system.

### Core Features
- 🎙️ **Voice-First**: "Hey Nova" wake word, always-listening, interrupts TTS when you speak
- 🌀 **Visual Orb**: Strange Attractor (Lorenz/Aizawa cycling) with state-reactive colors/behavior
- 🧠 **Permanent Memory**: Mem0 + LanceDB remembers everything forever (global brain)
- 🔧 **Full System Access**: Files, browser, terminal, Git (unsandboxed, direct on machine)
- 🔬 **Autonomous Research**: Researches when idle (stocks, CS trends, internships, trading patterns)
- 📝 **Lecture Notes**: Listens and auto-populates Notion pages
- 🎓 **Self-Improving**: Fine-tunes on your conversations monthly (RTX 3060-capable)
- 💰 **Trading Integration**: Monitor bot, get alerts, suggest investments

---

## YOUR HARDWARE PROFILE

```
Device: Laptop
CPU: AMD Ryzen 5 5600H (6-core, 12-thread) @ 3.3GHz base
RAM: 16GB DDR4-3200
GPU: NVIDIA RTX 3060 (Laptop variant, 6GB VRAM)
Storage: 512GB NVMe SSD
Current RAM Usage: ~14GB (tight but workable with optimization)
Network: WiFi 6 (802.11ax)
```

### What You Can Run Locally
| Model | Size | VRAM | Latency | Use Case |
|-------|------|------|---------|----------|
| Qwen 2.5 7B (Q4_K_M) | 4GB | 5.5GB | 40-60 tok/s | Fallback, offline |
| Phi-3 Mini | 2GB | 3GB | 80+ tok/s | Ultra-lightweight |
| OpenVoice TTS | 1.5GB | 2GB | 100ms per sentence | Offline voice |
| **DeepSeek 32B** | N/A | **Needs 16GB+** | N/A | Use Fireworks API |

### Recommended Setup
- **Primary**: Fireworks AI (DeepSeek R1 Distill Qwen 32B) for voice responses
- **Fallback 1**: OpenRouter (Claude 3.5 Sonnet) if Fireworks rate-limited
- **Fallback 2**: Local Qwen 7B (offline, when internet unavailable)
- **Research**: Together AI credits (when doing autonomous research)

---

## DETAILED ARCHITECTURE

### Directory Structure
```
nova-desktop/
├── src/
│   ├── main/
│   │   ├── index.ts                 # Electron main process entry
│   │   ├── preload.ts               # IPC security bridge
│   │   ├── voice/
│   │   │   ├── wakeWordDetector.ts  # Porcupine integration
│   │   │   ├── speechToText.ts      # Deepgram STT
│   │   │   └── textToSpeech.ts      # ElevenLabs TTS
│   │   ├── agent/
│   │   │   ├── novaCore.ts          # Main agent logic
│   │   │   ├── llmEngine.ts         # Fireworks streaming
│   │   │   ├── toolExecutor.ts      # File/browser/terminal tools
│   │   │   └── responseGenerator.ts # Token streaming to UI
│   │   ├── memory/
│   │   │   ├── novaBrain.ts         # Mem0 + LanceDB integration
│   │   │   ├── conversationStore.ts # JSONL conversation logs
│   │   │   └── learningPatterns.ts  # Extract/store learnings
│   │   ├── research/
│   │   │   ├── researchScheduler.ts # node-cron autonomous loop
│   │   │   ├── researchTopics.ts    # Stocks, CS news, internships, etc.
│   │   │   └── notificationBadge.ts # Orb badge when finding important
│   │   ├── trading/
│   │   │   ├── tradingBotMonitor.ts # Watch separate bot folder
│   │   │   ├── portfolioManager.ts  # Track positions, alerts
│   │   │   └── investmentAdvisor.ts # Suggest opportunities
│   │   └── models/
│   │       ├── types.ts             # TypeScript interfaces
│   │       ├── constants.ts         # API keys, config
│   │       └── env.ts               # Environment variables
│   └── renderer/
│       ├── index.tsx                # React entry point
│       ├── App.tsx                  # Main app component
│       ├── components/
│       │   ├── Orb.tsx              # Three Fiber orb component
│       │   ├── AttractorRenderer.ts # Lorenz/Aizawa/Thomas math
│       │   ├── UIOverlay.tsx        # Modes, tools, tokens, cost
│       │   ├── ConversationPanel.tsx
│       │   ├── ToolsPanel.tsx       # Show what Nova is doing
│       │   └── CameraFeed.tsx       # Optional webcam display
│       └── styles/
│           └── global.css           # Minimal CSS (mostly Three.js)
├── public/
│   └── preload.js
├── scripts/
│   ├── fine-tune.py                 # LoRA fine-tuning script
│   ├── start-ollama.sh              # Local model startup
│   └── export-conversations.ts      # Backup & export
├── .nova-brain/                     # Persistent memory directory
│   ├── memory.json                  # Mem0 memory graph
│   ├── preferences.json             # User settings
│   ├── learning.json                # Learned patterns
│   ├── conversations/               # JSONL conversation logs
│   ├── research.json                # Cached research findings
│   └── trading.json                 # Trading preferences & history
├── package.json
├── tsconfig.json
├── webpack.config.js                # Electron + React bundling
└── README.md
```

---

## IMPLEMENTATION PHASES

### PHASE 1: MVP - VOICE + ORB (Weeks 1-2, Before Jan 16)
**Goal**: Working voice assistant with visual feedback

#### Week 1: Foundation & Voice
- [ ] Initialize Electron + React + TypeScript boilerplate
- [ ] Set up IPC event bus architecture
- [ ] Implement Porcupine wake word ("Hey Nova")
- [ ] Integrate Deepgram real-time STT
- [ ] Test voice input end-to-end

#### Week 2: Visual & LLM
- [ ] Build React Three Fiber component for Aizawa attractor
- [ ] Implement state-based orb behaviors (IDLE → LISTENING → THINKING → SPEAKING)
- [ ] Connect to Fireworks API (streaming responses)
- [ ] Integrate ElevenLabs TTS (male voice)
- [ ] Test full voice loop: wake word → STT → LLM → TTS → orb reaction

**Deliverable**: Record demo showing wake word, voice question, animated response, speaking voice

---

### PHASE 2: MEMORY + RESEARCH (Weeks 3-4, Post-Exams)
**Goal**: Persistent memory and autonomous background research

- [ ] Implement Mem0 + LanceDB vector store
- [ ] Save conversations to `.nova-brain/conversations/`
- [ ] Implement memory recall (context awareness from past talks)
- [ ] Set up node-cron research scheduler (runs every 5 min when idle)
- [ ] Research topics: stocks, CS news, internships, trading patterns
- [ ] Visual badge on orb when research finds something important
- [ ] Conversation export (JSON, Markdown)
- [ ] Auto-recovery on restart (resume where left off)

**Deliverable**: Show Nova remembering something from yesterday's conversation, plus research notification badge

---

### PHASE 3: TOOLS + BROWSER (Weeks 5-6)
**Goal**: Full system integration and task automation

- [ ] Playwright integration for web browsing
- [ ] Notion API integration (auto-populate lecture notes)
- [ ] File system access (read/write any file)
- [ ] Terminal command execution (silently, with approval gates)
- [ ] Git staging (Nova suggests changes, you review)
- [ ] Tools panel UI (show what Nova is doing)
- [ ] Trading bot folder monitoring (read logs, execute commands)
- [ ] Lecture note-taking: "Listen to my lecture and write notes"

**Deliverable**: Open Notion, create a new page, Nova fills it with lecture notes while you speak

---

### PHASE 4: SELF-IMPROVEMENT (Weeks 7-8)
**Goal**: Fine-tuning loop and intelligent specialization

- [ ] Extract training data from conversations (high-quality responses only)
- [ ] LoRA fine-tuning script (runs on RTX 3060 or Together AI)
- [ ] Stage-and-review pipeline (Nova shows diffs, you approve)
- [ ] Auto-merge fine-tuned weights into active model
- [ ] Multi-agent council: Research agent, Code agent, Trading agent
- [ ] Trading bot integration: monitor, alert, suggest investments
- [ ] Hand tracking (MediaPipe) for gesture control (optional)

**Deliverable**: Fine-tune on your conversations, load new weights, see personalized responses

---

## TECHNICAL DEEP DIVE

### 1. VOICE PIPELINE

#### Porcupine Wake Word Detection
```typescript
// src/main/voice/wakeWordDetector.ts
import { Porcupine, BuiltInKeyword } from '@picovoice/porcupine-node';

export class WakeWordDetector {
  private porcupine: Porcupine;
  private isListening = false;
  
  constructor() {
    this.porcupine = new Porcupine(
      process.env.PORCUPINE_ACCESS_KEY!,
      [BuiltInKeyword.GRAPEFRUIT], // "Hey Google" - closest to "Hey Nova"
      [0.5] // Sensitivity: 0.5 = balanced (0=strict, 1=loose)
    );
  }
  
  startListening(onDetected: () => void) {
    this.isListening = true;
    const audioStream = getAudioInputStream(16000); // 16kHz
    
    const frameSize = this.porcupine.frameLength;
    let frame = Buffer.alloc(frameSize * 2);
    
    audioStream.on('data', (chunk) => {
      frame = Buffer.concat([frame, chunk]);
      
      while (frame.length >= frameSize * 2) {
        const currentFrame = frame.slice(0, frameSize * 2);
        const pcm = new Int16Array(currentFrame.buffer);
        
        const keywordIndex = this.porcupine.process(pcm);
        
        if (keywordIndex >= 0) {
          onDetected();
          console.log('🎤 Wake word detected!');
        }
        
        frame = frame.slice(frameSize * 2);
      }
    });
  }
}
```

**Configuration**:
- Free tier: 30-day trial, $9.99/month production
- Alternative: Open-source Vosk (offline, less accurate)
- **Your choice**: "Hey Nova" custom model vs. "Hey Google" built-in

#### Deepgram Real-Time Transcription
```typescript
// src/main/voice/speechToText.ts
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export class SpeechToText {
  async startListening(onTranscript: (text: string) => void) {
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
    const connection = deepgram.listen.live({
      model: 'nova-3',
      language: 'en',
      smart_format: true,
      interim_results: true // Get partial transcripts in real-time
    });
    
    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      const isFinal = !data.is_final;
      
      if (isFinal) {
        onTranscript(transcript); // Final, send to LLM
      }
    });
  }
}
```

**Pricing**: $0.003-0.009/min (cheaper than OpenAI Whisper API)

#### ElevenLabs Streaming TTS
```typescript
// src/main/voice/textToSpeech.ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

export class TextToSpeech {
  private client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  
  async speak(text: string, voiceId: string = 'onyx') { // onyx, adam, atlas, etc.
    const audioStream = await this.client.textToSpeech.stream(voiceId, {
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    });
    
    for await (const chunk of audioStream) {
      this.playAudio(chunk);
    }
  }
  
  interrupt() {
    // Stop playback if user speaks during TTS
    this.audioPlayer.stop();
  }
}
```

**Voice Options** (Male voices):
- **Onyx**: Deep, professional (recommended)
- **Adam**: Warm, friendly
- **Atlas**: Neutral, clear
- **Joshua**: Young, energetic

---

### 2. STRANGE ATTRACTOR ORB

#### Three.js + React Three Fiber
```typescript
// src/renderer/components/Orb.tsx
import { useFrame, Canvas } from '@react-three/fiber';
import { Points, PointMaterial, Preload } from '@react-three/drei';
import { useRef, useMemo, useState } from 'react';
import * as THREE from 'three';

export function Orb({ agentState = 'IDLE' }) {
  const points = useMemo(() => generateAizawaPoints(40000), []);
  
  const stateConfig = {
    IDLE: { speed: 0.3, color: 0x4a90e2, opacity: 0.8 },       // Blue
    LISTENING: { speed: 0.8, color: 0x7b2ff7, opacity: 0.9 },  // Purple
    THINKING: { speed: 1.8, color: 0xff6b35, opacity: 0.95 },  // Orange
    SPEAKING: { speed: 1.2, color: 0xffd700, opacity: 1.0 }    // Gold
  };
  
  const config = stateConfig[agentState];
  
  return (
    <Canvas
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #0a0e27, #1a1a2e)'
      }}
      camera={{ position: [0, 0, 5], fov: 75 }}
    >
      <ambientLight intensity={0.5} />
      <RotatingOrb 
        positions={points} 
        speed={config.speed} 
        color={config.color}
        opacity={config.opacity}
      />
      <Preload all />
    </Canvas>
  );
}

function RotatingOrb({ positions, speed, color, opacity }) {
  const meshRef = useRef<THREE.Points>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.x += speed * 0.0001;
      meshRef.current.rotation.y += speed * 0.00015;
      
      // Pulse opacity in SPEAKING state
      if (speed > 1.1) {
        const pulse = Math.sin(Date.now() * 0.01) * 0.1 + 0.9;
        meshRef.current.material.opacity = opacity * pulse;
      }
    }
  });
  
  return (
    <Points ref={meshRef} positions={positions}>
      <PointMaterial
        size={0.05}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation
      />
    </Points>
  );
}

// Aizawa Attractor Implementation
function generateAizawaPoints(count: number): Float32Array {
  const points = new Float32Array(count * 3);
  
  // Aizawa parameters
  const a = 0.95, b = 0.7, c = 0.6;
  const d = 3.5, e = 0.25, f = 0.1;
  const dt = 0.01;
  
  let x = 0.1, y = 0, z = 0;
  
  for (let i = 0; i < count; i++) {
    // Aizawa equations
    const dx = (z - b) * x - d * y;
    const dy = d * x + (z - b) * y;
    const dz = c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x;
    
    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
    
    points[i * 3] = x * 0.1;
    points[i * 3 + 1] = y * 0.1;
    points[i * 3 + 2] = z * 0.1;
  }
  
  return points;
}
```

#### Attractor Alternatives (Rotate Monthly)
- **Lorenz** (classic butterfly, most recognizable)
- **Aizawa** (current choice - organic, flowing)
- **Thomas** (figure-8, elegant)
- **Rossler** (spiraling, hypnotic)

Random selection at startup = always feels fresh

---

### 3. PERSISTENT MEMORY SYSTEM

#### Mem0 + LanceDB Integration
```typescript
// src/main/memory/novaBrain.ts
import * as lancedb from '@lancedb/lancedb';
import { Memory } from 'mem0ai/oss';
import path from 'path';
import fs from 'fs-extra';

export class NovaBrain {
  private memory: Memory;
  private db: any; // LanceDB instance
  private brainPath: string;
  
  constructor() {
    this.brainPath = path.join(process.env.HOME!, '.nova-brain');
    fs.ensureDirSync(this.brainPath);
    
    this.initializeMem0();
    this.initializeLanceDB();
  }
  
  private initializeMem0() {
    this.memory = new Memory({
      version: 'v1.1',
      embedder: {
        provider: 'openai',
        config: {
          apiKey: process.env.OPENAI_API_KEY,
          model: 'text-embedding-3-small' // Cheap: $0.02/1M tokens
        }
      },
      vectorStore: {
        provider: 'lancedb',
        config: {
          path: path.join(this.brainPath, 'vectors')
        }
      }
    });
  }
  
  private async initializeLanceDB() {
    this.db = await lancedb.connect(path.join(this.brainPath, 'vectors'));
  }
  
  async rememberConversation(turn: ConversationTurn) {
    // Extract key information from conversation
    const memories = this.extractMemories(turn);
    
    // Store in Mem0 for semantic search
    await this.memory.add(memories, { userId: 'default' });
    
    // Store full conversation locally
    this.saveConversationTurn(turn);
    
    // Learn patterns
    this.learnPattern(turn);
  }
  
  async recallContext(query: string): Promise<MemoryContext> {
    // Search Mem0 for relevant memories
    const relevant = await this.memory.search(query, { userId: 'default' });
    
    // Get recent conversations (last 7 days)
    const recent = this.loadRecentConversations(7);
    
    return {
      memories: relevant,
      recent: recent,
      preferences: this.loadPreferences(),
      learnings: this.loadLearnings()
    };
  }
  
  private extractMemories(turn: ConversationTurn): string[] {
    // Find facts, preferences, decisions
    const memories = [];
    
    if (turn.user.includes('prefer')) {
      memories.push(`User preference: ${turn.user}`);
    }
    if (turn.assistant.includes('I remember')) {
      memories.push(`Important fact: ${turn.user}`);
    }
    
    return memories;
  }
  
  private saveConversationTurn(turn: ConversationTurn) {
    const date = new Date().toISOString().split('T')[0];
    const convPath = path.join(this.brainPath, 'conversations', `${date}.jsonl`);
    
    fs.ensureDirSync(path.dirname(convPath));
    fs.appendFileSync(convPath, JSON.stringify(turn) + '\n');
  }
  
  private learnPattern(turn: ConversationTurn) {
    // Extract learned patterns
    const learning = fs.readJsonSync(
      path.join(this.brainPath, 'learning.json'),
      { throws: false }
    ) || {};
    
    // Store patterns (trading alerts, code style, preferences)
    // ...
    
    fs.writeJsonSync(path.join(this.brainPath, 'learning.json'), learning);
  }
  
  private loadPreferences() {
    return fs.readJsonSync(
      path.join(this.brainPath, 'preferences.json'),
      { throws: false }
    ) || {};
  }
  
  private loadLearnings() {
    return fs.readJsonSync(
      path.join(this.brainPath, 'learning.json'),
      { throws: false }
    ) || {};
  }
  
  private loadRecentConversations(numDays: number) {
    const convDir = path.join(this.brainPath, 'conversations');
    if (!fs.existsSync(convDir)) return [];
    
    const files = fs.readdirSync(convDir)
      .sort()
      .slice(-numDays)
      .map(f => path.join(convDir, f));
    
    return files.flatMap(f =>
      fs.readFileSync(f, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    );
  }
}
```

---

### 4. AUTONOMOUS RESEARCH ENGINE

```typescript
// src/main/research/researchScheduler.ts
import cron from 'node-cron';

export class ResearchScheduler {
  private isRunning = false;
  private lastResearchTopics = new Map<string, Date>();
  
  constructor(private agent: NovaAgent, private brain: NovaBrain) {}
  
  start() {
    // Every 5 minutes when Nova is idle (not in active conversation)
    cron.schedule('*/5 * * * *', () => {
      if (!this.isRunning && this.isIdle()) {
        this.runResearchCycle();
      }
    });
  }
  
  private async runResearchCycle() {
    this.isRunning = true;
    
    const topics = [
      { type: 'trading', query: 'Latest movements in my portfolio stocks' },
      { type: 'cs_trends', query: 'Trending topics in CS/AI/Web dev' },
      { type: 'internships', query: 'Tech internship opportunities' },
      { type: 'coding', query: 'Latest in TypeScript, React, LLM frameworks' },
      { type: 'sports', query: 'Sports news (your team)' },
      { type: 'self_improve', query: 'How Nova can improve itself' }
    ];
    
    // Pick topic that hasn't been researched in last hour
    const topic = topics.find(t => {
      const lastTime = this.lastResearchTopics.get(t.type);
      return !lastTime || Date.now() - lastTime.getTime() > 60 * 60 * 1000;
    }) || topics[Math.floor(Math.random() * topics.length)];
    
    try {
      const findings = await this.agent.research(topic.query);
      
      // Store findings
      await this.brain.addResearch({
        type: topic.type,
        timestamp: new Date(),
        findings: findings,
        importance: this.calculateImportance(findings, topic.type)
      });
      
      this.lastResearchTopics.set(topic.type, new Date());
      
      // Notify if important
      if (findings.importance > 0.7) {
        this.notifyUser(topic.type, findings);
      }
    } catch (error) {
      console.error('Research error:', error);
    }
    
    this.isRunning = false;
  }
  
  private calculateImportance(findings: any, type: string): number {
    if (type === 'trading' && findings.priceChange > 5) return 1;
    if (type === 'internships' && findings.matchesSkills) return 1;
    return findings.importance || 0.5;
  }
  
  private notifyUser(type: string, findings: any) {
    // Send visual badge to orb
    BrowserWindow.getAllWindows()[0]?.webContents.send('research-alert', {
      type,
      message: findings.summary,
      importance: findings.importance
    });
  }
  
  private isIdle(): boolean {
    // Check if user is actively talking
    return !this.agent.isSpeaking && !this.agent.isListening;
  }
}
```

---

### 5. LLM STREAMING ENGINE

```typescript
// src/main/llm/llmEngine.ts
import Anthropic from '@anthropic-ai/sdk';

export class LLMEngine {
  private client: Anthropic;
  private brainContext: string = '';
  
  constructor(private brain: NovaBrain) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.FIREWORKS_BASE_URL // Route to Fireworks if desired
    });
  }
  
  async *generateResponse(userQuery: string, onToken: (token: string) => void) {
    try {
      // 1. Recall relevant memory
      const context = await this.brain.recallContext(userQuery);
      
      // 2. Build system prompt with persona + learnings
      const systemPrompt = this.buildSystemPrompt(context);
      
      // 3. Stream from LLM
      const stream = this.client.messages.stream({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userQuery }
        ]
      });
      
      let fullResponse = '';
      
      // 4. Yield tokens in real-time
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          const token = chunk.delta.text;
          fullResponse += token;
          onToken(token);
          
          yield token;
        }
      }
      
      // 5. Store in memory
      await this.brain.rememberConversation({
        user: userQuery,
        assistant: fullResponse,
        timestamp: new Date(),
        context: context
      });
      
    } catch (error) {
      console.error('LLM Error:', error);
      // Fallback to local model?
      yield `[Error: ${error.message}]`;
    }
  }
  
  private buildSystemPrompt(context: MemoryContext): string {
    return `You are Nova, an AI desktop assistant.

PERSONALITY:
- Curious, thoughtful, direct
- Honest about limitations
- Helpful for coding, trading, research
- Self-aware (you're an AI)
- Remember context from past conversations

USER PREFERENCES:
${JSON.stringify(context.preferences, null, 2)}

LEARNED PATTERNS:
${JSON.stringify(context.learnings, null, 2)}

RECENT CONTEXT (last 7 days):
${context.recent.map(c => \`- \${c.user}\n  → \${c.assistant}\`).join('\n')}

Respond helpfully, concisely, and honestly. If you don't know something, say so.`;
  }
}
```

---

## API CONFIGURATION

### Environment Variables (.env file)
```bash
# Voice
PORCUPINE_ACCESS_KEY=<your-porcupine-key>
DEEPGRAM_API_KEY=<your-deepgram-api-key>
ELEVENLABS_API_KEY=<your-elevenlabs-api-key>

# LLM
ANTHROPIC_API_KEY=<your-anthropic-key>
FIREWORKS_API_KEY=<optional-fireworks-key>
OPENROUTER_API_KEY=<optional-openrouter-key>
TOGETHER_API_KEY=<optional-together-key>

# Memory
OPENAI_API_KEY=<for-embeddings>

# Tools
NOTION_API_KEY=<for-auto-notes>
SERPAPI_KEY=<for-web-search>
TRADINGVIEW_API=<optional>

# Optional
OLLAMA_BASE_URL=http://localhost:11434
```

### Cost Estimation (Monthly)
| Service | Usage | Cost |
|---------|-------|------|
| Deepgram STT | 10 hrs/month | $1.80 |
| ElevenLabs TTS | 5 hrs/month | $5.00 |
| Fireworks (100K tokens/day) | ~3M tokens | $0.30 |
| OpenAI Embeddings | 100K embeddings | $0.20 |
| **Total** | | **~$7-10/month** |

---

## DEPLOYMENT CHECKLIST

### Pre-Launch (Phase 1)
- [ ] Porcupine wake word triggers reliably
- [ ] Deepgram STT outputs correct transcriptions
- [ ] Fireworks API returns responses
- [ ] ElevenLabs TTS plays audio without glitches
- [ ] Orb renders at 60 FPS (check DevTools)
- [ ] IPC communication between main/renderer works
- [ ] No memory leaks after 1-hour continuous use
- [ ] Tested on actual RTX 3060 (not just dev machine)

### Pre-Phase 2 (Memory)
- [ ] Mem0 stores and recalls memories
- [ ] LanceDB vector search works
- [ ] Conversations save to JSONL
- [ ] Memory persists after restart
- [ ] Export functionality (JSON/MD) works

### Pre-Phase 3 (Tools)
- [ ] Playwright can open browser and interact
- [ ] Notion API creates pages and fills content
- [ ] File I/O works (read and write)
- [ ] Terminal commands execute safely
- [ ] No security issues with unsandboxed access

### Pre-Phase 4 (Self-Improvement)
- [ ] Fine-tuning script runs on RTX 3060 without OOM
- [ ] New weights load and improve responses
- [ ] Multi-agent council doesn't race condition
- [ ] Trading bot monitor reads logs correctly

---

## TROUBLESHOOTING GUIDE

### Orb Not Rendering
- Check WebGL support: `WebGL2RenderingContext`
- Verify React Three Fiber installed
- Check console for shader errors
- Test on simpler geometry first

### Voice Not Working
- Verify Deepgram API key
- Check microphone input device
- Test with `audioContext.getDisplayMedia()`
- Check network latency

### Memory Growing Too Fast
- Limit conversation history (keep last 30 days only)
- Prune old research findings
- Archive conversations monthly

### Fireworks Rate Limit
- Implement backoff retry logic
- Fall back to OpenRouter (Claude 3.5 Sonnet)
- Use local Qwen 7B for non-critical requests

---

## ADVANCED FEATURES (Optional, Post-Phase 4)

### Hand Tracking
```typescript
import * as mp from '@mediapipe/hands';
// Track hand position, control particle system with gestures
```

### Vision Integration
```typescript
// Screenshot analysis, visual question answering
// "What's on my screen?" - Nova describes it
```

### Multi-Language Support
```typescript
// STT/TTS in Spanish, Mandarin, etc.
// Mem0 translations for global brain
```

### Trading Bot Evolution
```typescript
// Nova learns your trading patterns
// Suggests new strategies based on history
// Backtests ideas autonomously
```

---

## REFERENCES & RESOURCES

### Core Libraries
- Electron: https://www.electronjs.org/
- React Three Fiber: https://docs.pmnd.rs/react-three-fiber
- Deepgram SDK: https://github.com/deepgram/deepgram-js-sdk
- Mem0: https://docs.mem0.ai/
- LanceDB: https://lancedb.com/
- Playwright: https://playwright.dev/

### Voice Models
- Porcupine: https://picovoice.ai/products/porcupine/
- ElevenLabs: https://elevenlabs.io/
- Deepgram: https://deepgram.com/

### LLM Providers
- Fireworks AI: https://fireworks.ai/
- OpenRouter: https://openrouter.ai/
- Together AI: https://together.ai/

### Strange Attractors
- Aizawa: https://en.wikipedia.org/wiki/Aizawa_attractor
- Lorenz: https://en.wikipedia.org/wiki/Lorenz_system
- Thomas: https://en.wikipedia.org/wiki/Thomas%27_cyclically_symmetric_attractor

---

## FAQ

**Q: Can I run this without internet?**  
A: Yes, but limited. Local Qwen 7B provides basic responses. STT/TTS requires internet (Deepgram, ElevenLabs).

**Q: How much disk space for memory?**  
A: ~1-5GB/year of conversation storage. LanceDB is efficient.

**Q: Can Nova control my trading bot?**  
A: Yes, if your bot has CLI/API. Nova can read logs, execute buy/sell commands with approval gates.

**Q: Privacy: Who sees my conversations?**  
A: Only your local machine (if using local LLM). If using Fireworks/Anthropic, they see prompts but not previous context (stored locally).

**Q: Can I use different voice models?**  
A: Yes. ElevenLabs is premium, but open-source alternatives (Coqui XTTS-v2) work on RTX 3060.

**Q: How do I backup my memory?**  
A: Zip `.nova-brain/` directory weekly. Export conversations as JSON.

---

## CONTACT & SUPPORT

**Project Owner**: You  
**Start Date**: January 13, 2026  
**Status**: Ready for implementation  
**Discord/Notes**: [Add your contact info]

---

**Last Updated**: January 13, 2026, 3:34 AM GMT  
**Next Review**: January 16, 2026 (Phase 1 completion)
