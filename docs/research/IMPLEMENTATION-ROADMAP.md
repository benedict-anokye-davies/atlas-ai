# Atlas Intelligence Platform - Implementation Roadmap

**Date:** January 22, 2026  
**Timeline:** ~12 weeks  
**Source:** Company research from Anduril, Shield AI, Scale AI, Hume AI, Deepgram, Cartesia, Anthropic MCP, OpenAI Operator, Adept AI, MultiOn, Browserbase, Two Sigma, Jane Street, Jump Trading, Alpaca, Cursor, Glean, Replit

---

## Phase Overview

| Phase | Weeks | Focus Area | Key Deliverable |
|-------|-------|------------|-----------------|
| **Phase 0** | 1 | Quick Wins | Deepgram upgrades, Cartesia optimization, Alpaca trading, kill switches |
| **Phase 1** | 2-3 | Voice & Emotion | Prosody-based emotion detection, expressive TTS |
| **Phase 2** | 3-4 | MCP Protocol | MCP server/client, Claude Desktop integration |
| **Phase 3** | 4-6 | Trading Intelligence | Regime detection, event-driven pipeline |
| **Phase 4** | 6-8 | Browser Agent | Natural language API, workflow DSL |
| **Phase 5** | 8-12 | Intelligence & Learning | Sensor fusion, RLHF feedback |
| **Phase 6** | 10-12 | Codebase Intelligence | Indexing, tiered model selection |

---

## Phase 0: Quick Wins (Week 1)

Low-effort, high-impact improvements to implement immediately.

### QW-1: Deepgram Nova-2 Enhanced Configuration

**Source:** Deepgram research  
**Effort:** 2 hours  
**File:** `src/main/stt/deepgram-manager.ts`

**Current State:** Basic STT without multi-speaker support

**Enhancement:**
```typescript
const enhancedConfig = {
  model: 'nova-2',
  language: 'en-GB',
  smart_format: true,
  punctuate: true,
  diarize: true,           // NEW: Multi-speaker support
  utterances: true,         // NEW: Natural sentence boundaries
  interim_results: true,
  endpointing: 300,
  keywords: ['Atlas', 'trading', 'portfolio', 'Palantir', ...customKeywords]
};
```

**Tasks:**
- [ ] Add `diarize: true` for multi-speaker detection
- [ ] Add `utterances: true` for sentence boundaries
- [ ] Add `keywords` array for domain-specific terms
- [ ] Update `TranscriptionResult` type to include speaker ID
- [ ] Test with multiple speakers

**Expected Outcome:** Better recognition of Atlas-specific terms, multi-speaker support for meetings

---

### QW-2: Cartesia Sonic Optimization

**Source:** Cartesia research (already using)  
**Effort:** 1 hour  
**File:** `src/main/tts/cartesia.ts`

**Current State:** Using Cartesia Sonic with basic config

**Enhancement:**
```typescript
// Optimize Cartesia for emotion-adaptive responses
const optimizedConfig = {
  model_id: 'sonic-english',
  voice: {
    mode: 'id',
    id: config.cartesiaVoiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091'
  },
  output_format: {
    container: 'raw',
    encoding: 'pcm_s16le',
    sample_rate: 24000
  },
  // NEW: Emotion-based voice modulation
  voice_controls: {
    emotion: detectEmotionForTTS(userEmotion),  // Map user emotion
    speed: getSpeedForContext(context),          // Adjust for urgency
    pitch: 0                                      // Keep neutral
  }
};
```

**Tasks:**
- [ ] Add emotion-to-voice mapping function
- [ ] Implement speed adjustment based on context
- [ ] Add prosody controls for expressive output
- [ ] Test emotional response appropriateness

**Expected Outcome:** More natural, emotionally-appropriate voice responses

---

### QW-3: Alpaca Paper Trading Integration

**Source:** Alpaca research  
**Effort:** 4 hours  
**Files:** `src/main/trading/brokers/alpaca.ts` (new)

**Architecture:**
```
Atlas Trading System
        ↓
  Broker Interface (abstract)
        ↓
  ┌─────────────────┐
  │ Alpaca Adapter  │ ← Paper/Live toggle
  │ Binance Adapter │
  │ IBKR Adapter    │
  └─────────────────┘
```

**Implementation:**
```typescript
import Alpaca from '@alpacahq/alpaca-trade-api';

interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  paper: boolean;  // Toggle paper/live
}

class AlpacaBroker implements Broker {
  private client: Alpaca;
  
  constructor(config: AlpacaConfig) {
    this.client = new Alpaca({
      keyId: config.keyId,
      secretKey: config.secretKey,
      paper: config.paper
    });
  }
  
  async placeOrder(order: Order): Promise<OrderResult> {
    return this.client.createOrder({
      symbol: order.symbol,
      qty: order.quantity,
      side: order.side,
      type: order.type,
      time_in_force: 'day'
    });
  }
  
  async getPositions(): Promise<Position[]> {
    return this.client.getPositions();
  }
  
  async streamQuotes(symbols: string[]): AsyncGenerator<Quote> {
    const stream = this.client.data_stream_v2;
    stream.connect();
    stream.subscribeForBars(symbols);
    
    for await (const bar of stream.onStockBar()) {
      yield { symbol: bar.Symbol, price: bar.ClosePrice, volume: bar.Volume };
    }
  }
}
```

**Tasks:**
- [ ] Create `src/main/trading/brokers/alpaca.ts`
- [ ] Implement `Broker` interface
- [ ] Add `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` to env
- [ ] Add paper trading toggle in settings
- [ ] Test order placement in paper mode
- [ ] Add streaming quote support

**Expected Outcome:** Safe strategy testing with real market data, no financial risk

---

### QW-4: Project Rules System (.atlas-rules)

**Source:** Cursor AI research  
**Effort:** 3 hours  
**Files:** `src/main/agent/project-rules.ts` (new)

**Purpose:** Load project-specific AI guidance from workspace

**Implementation:**
```typescript
interface ProjectRules {
  codeStyle: string[];
  architecture: string[];
  patterns: string[];
  donts: string[];
  context: string[];
}

class ProjectRulesManager {
  private rulesCache: Map<string, ProjectRules> = new Map();
  
  async loadRules(workspacePath: string): Promise<ProjectRules | null> {
    const cached = this.rulesCache.get(workspacePath);
    if (cached) return cached;
    
    const rulesFile = path.join(workspacePath, '.atlas-rules');
    if (!await exists(rulesFile)) return null;
    
    const content = await fs.readFile(rulesFile, 'utf-8');
    const rules = this.parseRulesFile(content);
    this.rulesCache.set(workspacePath, rules);
    return rules;
  }
  
  injectIntoPrompt(systemPrompt: string, rules: ProjectRules): string {
    const rulesSection = `
[PROJECT RULES]
Code Style: ${rules.codeStyle.join('; ')}
Architecture: ${rules.architecture.join('; ')}
Patterns: ${rules.patterns.join('; ')}
Never: ${rules.donts.join('; ')}
Context: ${rules.context.join('; ')}
`;
    return systemPrompt + rulesSection;
  }
  
  private parseRulesFile(content: string): ProjectRules {
    // Parse markdown sections: ## Code Style, ## Architecture, etc.
    const sections = this.extractSections(content);
    return {
      codeStyle: sections['Code Style'] || [],
      architecture: sections['Architecture'] || [],
      patterns: sections['Patterns'] || [],
      donts: sections['Never'] || sections["Don'ts"] || [],
      context: sections['Context'] || []
    };
  }
}
```

**Example `.atlas-rules` file:**
```markdown
# Atlas Rules

## Code Style
- Use TypeScript strict mode
- Prefer functional patterns over classes
- All async functions must have error handling

## Architecture  
- Main process code in src/main/
- Renderer code in src/renderer/
- Shared types in src/shared/types/

## Patterns
- Singleton pattern for managers (getXxxManager())
- IPC handlers return { success, data?, error? }
- Tools follow ToolDefinition interface

## Never
- Don't use `any` type
- Don't mutate function parameters
- Don't use console.log (use logger)

## Context
- This is an Electron desktop app
- Voice-first interaction model
- Real-time trading integration
```

**Tasks:**
- [ ] Create `src/main/agent/project-rules.ts`
- [ ] Implement markdown parser for rules sections
- [ ] Integrate with LLM system prompt building
- [ ] Create `.atlas-rules` for Atlas itself
- [ ] Add file watcher for hot-reload

**Expected Outcome:** AI understands project conventions, writes consistent code

---

### QW-5: Trading Risk Kill Switches

**Source:** HFT research  
**Effort:** 3 hours  
**File:** `src/main/trading/risk/kill-switches.ts` (new)

**Purpose:** Pre-trade risk checks with automatic circuit breakers

**Implementation:**
```typescript
interface RiskLimits {
  maxDailyLoss: number;        // e.g., -500 (GBP)
  maxPositionSize: number;     // e.g., 5000 (GBP)
  maxConcentration: number;    // e.g., 0.2 (20% of portfolio)
  maxOrdersPerMinute: number;  // e.g., 10
  maxDrawdown: number;         // e.g., 0.1 (10% from peak)
}

const DEFAULT_LIMITS: RiskLimits = {
  maxDailyLoss: -500,
  maxPositionSize: 5000,
  maxConcentration: 0.2,
  maxOrdersPerMinute: 10,
  maxDrawdown: 0.1
};

class KillSwitchManager extends EventEmitter {
  private triggered = false;
  private triggerReason?: string;
  private dailyPnL = 0;
  private peakPortfolioValue = 0;
  private ordersThisMinute = 0;
  
  checkOrder(order: Order, portfolio: Portfolio): RiskResult {
    // Kill switch already triggered
    if (this.triggered) {
      return { allowed: false, reason: `Kill switch active: ${this.triggerReason}` };
    }
    
    // Daily loss limit
    if (this.dailyPnL <= this.limits.maxDailyLoss) {
      this.trigger('Daily loss limit exceeded');
      return { allowed: false, reason: 'Daily loss limit exceeded' };
    }
    
    // Position size limit
    const orderValue = order.quantity * order.price;
    if (orderValue > this.limits.maxPositionSize) {
      return { allowed: false, reason: `Order size ${orderValue} exceeds limit ${this.limits.maxPositionSize}` };
    }
    
    // Concentration limit
    const newConcentration = (portfolio.getPosition(order.symbol)?.value || 0 + orderValue) / portfolio.totalValue;
    if (newConcentration > this.limits.maxConcentration) {
      return { allowed: false, reason: `Concentration ${(newConcentration * 100).toFixed(1)}% exceeds limit` };
    }
    
    // Order rate limit
    if (this.ordersThisMinute >= this.limits.maxOrdersPerMinute) {
      return { allowed: false, reason: 'Order rate limit exceeded' };
    }
    
    // Drawdown limit
    const currentDrawdown = 1 - (portfolio.totalValue / this.peakPortfolioValue);
    if (currentDrawdown > this.limits.maxDrawdown) {
      this.trigger(`Drawdown ${(currentDrawdown * 100).toFixed(1)}% exceeded limit`);
      return { allowed: false, reason: 'Maximum drawdown exceeded' };
    }
    
    return { allowed: true };
  }
  
  trigger(reason: string): void {
    this.triggered = true;
    this.triggerReason = reason;
    this.emit('kill-switch-triggered', { reason, timestamp: Date.now() });
    
    // Notify user via voice
    voicePipeline.speakProactive(
      `Trading kill switch activated: ${reason}. All trading halted.`,
      { priority: 'high', interruptCurrent: true }
    );
    
    logger.error('Kill switch triggered', { reason });
  }
  
  reset(): void {
    if (!this.triggered) return;
    this.triggered = false;
    this.triggerReason = undefined;
    this.emit('kill-switch-reset');
    logger.info('Kill switch reset');
  }
}

export const getKillSwitchManager = singleton(() => new KillSwitchManager());
```

**Tasks:**
- [ ] Create `src/main/trading/risk/kill-switches.ts`
- [ ] Implement daily loss limit check
- [ ] Implement position size limit
- [ ] Implement concentration limit
- [ ] Implement order rate limit
- [ ] Implement drawdown limit
- [ ] Add voice notification on trigger
- [ ] Add reset mechanism
- [ ] Integrate into order flow

**Expected Outcome:** Protection against runaway losses, automatic trading halt

---

## Phase 1: Voice & Emotion Intelligence (Weeks 2-3)

### P1-1: Voice Prosody Emotion Detection

**Source:** Hume AI EVI research  
**Effort:** 2 weeks  
**Priority:** HIGH

**Architecture:**
```
Audio Buffer (from VAD)
        ↓
  ┌─────────────────────────────────────────┐
  │         Prosody Feature Extractor        │
  │  ┌─────────┬──────────┬──────────────┐  │
  │  │ Pitch   │ Pace     │ Volume       │  │
  │  │ (FFT)   │ (WPM)    │ (RMS)        │  │
  │  └─────────┴──────────┴──────────────┘  │
  │  ┌─────────┬──────────┬──────────────┐  │
  │  │ Pauses  │ Jitter   │ Shimmer      │  │
  │  │ (Gaps)  │ (F0 var) │ (Amp var)    │  │
  │  └─────────┴──────────┴──────────────┘  │
  └─────────────────────────────────────────┘
        ↓
  Baseline Comparison (user's normal patterns)
        ↓
  ┌─────────────────────────────────────────┐
  │       Emotion Classifier                 │
  │  frustrated | excited | tired | anxious  │
  └─────────────────────────────────────────┘
        ↓
  LLM Context Injection: [PROSODY CONTEXT]
```

**Files to Create:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/voice/prosody/types.ts` | ~150 | Prosody feature types |
| `src/main/voice/prosody/feature-extractor.ts` | ~400 | Extract pitch, pace, volume |
| `src/main/voice/prosody/baseline-tracker.ts` | ~200 | Track user's normal patterns |
| `src/main/voice/prosody/emotion-classifier.ts` | ~350 | Classify emotion from deviation |
| `src/main/voice/prosody/index.ts` | ~50 | Module exports |

**Key Types:**
```typescript
interface ProsodyFeatures {
  pitch: {
    mean: number;    // Hz
    std: number;     // Standard deviation
    slope: number;   // Rising/falling intonation
    range: number;   // Max - min
  };
  pace: number;      // Words per minute (from word timestamps)
  volume: {
    mean: number;    // RMS amplitude
    std: number;
    peaks: number;   // Number of emphasis points
  };
  pauses: {
    count: number;
    totalMs: number;
    avgMs: number;
  };
  jitter: number;    // Pitch perturbation quotient
  shimmer: number;   // Amplitude perturbation quotient
}

interface ProsodyEmotionSignal {
  type: 'frustrated' | 'excited' | 'tired' | 'anxious' | 'neutral' | 'confused';
  confidence: number;
  indicators: string[];
  suggestedTone: 'calm' | 'energetic' | 'patient' | 'reassuring' | 'neutral';
  prosodyDeviation: {
    pitchDelta: number;   // vs baseline
    paceDelta: number;
    volumeDelta: number;
  };
}

interface UserBaseline {
  userId: string;
  samples: number;
  avgPitch: number;
  avgPace: number;
  avgVolume: number;
  lastUpdated: number;
}
```

**Emotion Detection Rules:**
```typescript
const EMOTION_RULES: EmotionRule[] = [
  {
    emotion: 'frustrated',
    rules: [
      { feature: 'pace', condition: 'above', threshold: 1.3 },     // 30% faster
      { feature: 'pitch.slope', condition: 'rising', threshold: 50 },
      { feature: 'volume.peaks', condition: 'above', threshold: 3 }
    ],
    minMatches: 2,
    confidence: 0.7
  },
  {
    emotion: 'excited',
    rules: [
      { feature: 'pitch.mean', condition: 'above', threshold: 1.2 },
      { feature: 'pace', condition: 'above', threshold: 1.2 },
      { feature: 'volume.mean', condition: 'above', threshold: 1.3 }
    ],
    minMatches: 2,
    confidence: 0.75
  },
  {
    emotion: 'tired',
    rules: [
      { feature: 'pace', condition: 'below', threshold: 0.8 },
      { feature: 'pitch.range', condition: 'below', threshold: 0.6 },
      { feature: 'pauses.avgMs', condition: 'above', threshold: 1.5 }
    ],
    minMatches: 2,
    confidence: 0.65
  },
  {
    emotion: 'anxious',
    rules: [
      { feature: 'jitter', condition: 'above', threshold: 1.5 },
      { feature: 'shimmer', condition: 'above', threshold: 1.4 },
      { feature: 'pace', condition: 'above', threshold: 1.15 }
    ],
    minMatches: 2,
    confidence: 0.6
  }
];
```

**Tasks:**
- [ ] Implement pitch extraction using FFT
- [ ] Implement pace calculation from Deepgram word timestamps
- [ ] Implement volume (RMS) calculation
- [ ] Implement jitter/shimmer calculation
- [ ] Build baseline tracker with exponential moving average
- [ ] Implement rules-based emotion classifier
- [ ] Integrate with existing EmotionDetector (combine text + voice)
- [ ] Inject into LLM system prompt as `[PROSODY CONTEXT]`

---

### P1-2: Expressive TTS Response

**Source:** Cartesia + Hume AI research  
**Effort:** 1 week  
**Dependencies:** P1-1

**File:** `src/main/tts/cartesia.ts` (modify)

**Implementation:**
```typescript
// Map detected user emotion to Cartesia voice controls
function getVoiceControlsForEmotion(emotion: ProsodyEmotionSignal): CartesiaVoiceControls {
  const controls: CartesiaVoiceControls = {
    emotion: [],
    speed: 'normal',
    pitch: 0
  };
  
  switch (emotion.type) {
    case 'excited':
      controls.emotion = [{ name: 'positivity', level: 'high' }];
      controls.speed = 'fast';
      break;
      
    case 'frustrated':
      controls.emotion = [
        { name: 'calmness', level: 'high' },
        { name: 'empathy', level: 'medium' }
      ];
      controls.speed = 'normal';
      break;
      
    case 'tired':
      controls.emotion = [{ name: 'calmness', level: 'medium' }];
      controls.speed = 'slow';
      break;
      
    case 'anxious':
      controls.emotion = [
        { name: 'reassurance', level: 'high' },
        { name: 'calmness', level: 'high' }
      ];
      controls.speed = 'slow';
      break;
      
    case 'confused':
      controls.emotion = [{ name: 'clarity', level: 'high' }];
      controls.speed = 'slow';  // Slower for clarity
      break;
  }
  
  return controls;
}

// Integrate into synthesis
async synthesizeWithEmotion(
  text: string, 
  userEmotion?: ProsodyEmotionSignal
): Promise<CartesiaSynthesisResult> {
  const voiceControls = userEmotion 
    ? getVoiceControlsForEmotion(userEmotion)
    : { emotion: [], speed: 'normal', pitch: 0 };
  
  return this.synthesize(text, { voiceControls });
}
```

**Tasks:**
- [ ] Map emotion types to Cartesia voice controls
- [ ] Add speed adjustment based on user emotion
- [ ] Add emotion tags (positivity, calmness, empathy, etc.)
- [ ] Test emotional response appropriateness
- [ ] Add user preference toggle for emotion matching

---

## Phase 2: MCP Protocol Integration (Weeks 3-4)

### P2-1: MCP Server Implementation

**Source:** Anthropic MCP research  
**Effort:** 2 weeks  
**Priority:** HIGH - Ecosystem integration

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Desktop │     │     Cursor      │     │  Other MCP      │
│     Windsurf    │     │                 │     │   Clients       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │ MCP Protocol (JSON-RPC)
                                 ↓
                    ┌───────────────────────────┐
                    │    Atlas MCP Server       │
                    │    localhost:3000         │
                    │                           │
                    │  ┌─────────────────────┐  │
                    │  │ 60+ Atlas Tools     │  │
                    │  │ - filesystem        │  │
                    │  │ - git               │  │
                    │  │ - browser           │  │
                    │  │ - trading           │  │
                    │  │ - banking           │  │
                    │  └─────────────────────┘  │
                    │                           │
                    │  ┌─────────────────────┐  │
                    │  │ Resources           │  │
                    │  │ - files             │  │
                    │  │ - memory            │  │
                    │  │ - knowledge graph   │  │
                    │  └─────────────────────┘  │
                    └───────────────────────────┘
```

**Files to Create:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/mcp/types.ts` | ~200 | MCP protocol types |
| `src/main/mcp/server.ts` | ~500 | MCP server implementation |
| `src/main/mcp/tool-adapter.ts` | ~300 | Convert Atlas tools to MCP |
| `src/main/mcp/resource-provider.ts` | ~250 | Expose Atlas resources |
| `src/main/mcp/index.ts` | ~100 | Server startup, exports |

**Implementation:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

class AtlasMCPServer {
  private server: Server;
  
  constructor() {
    this.server = new Server({
      name: 'atlas-desktop',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    });
    
    this.registerToolHandlers();
    this.registerResourceHandlers();
    this.registerPromptHandlers();
  }
  
  private registerToolHandlers(): void {
    // List all Atlas tools
    this.server.setRequestHandler('tools/list', async () => ({
      tools: getAllTools().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters
      }))
    }));
    
    // Execute tool
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;
      const tool = getToolByName(name);
      
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      
      try {
        const result = await tool.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    });
  }
  
  private registerResourceHandlers(): void {
    // List available resources
    this.server.setRequestHandler('resources/list', async () => ({
      resources: [
        {
          uri: 'atlas://memory/recent',
          name: 'Recent Conversations',
          mimeType: 'application/json'
        },
        {
          uri: 'atlas://knowledge/entities',
          name: 'Knowledge Graph Entities',
          mimeType: 'application/json'
        },
        {
          uri: 'file://{path}',
          name: 'File System',
          mimeType: 'text/plain'
        }
      ]
    }));
    
    // Read resource
    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;
      
      if (uri.startsWith('atlas://memory')) {
        const memory = await getMemoryManager().getRecentContext(10);
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(memory) }] };
      }
      
      if (uri.startsWith('file://')) {
        const path = uri.replace('file://', '');
        const content = await fs.readFile(path, 'utf-8');
        return { contents: [{ uri, mimeType: 'text/plain', text: content }] };
      }
      
      throw new Error(`Unknown resource: ${uri}`);
    });
  }
  
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Atlas MCP server started');
  }
}

export const startMCPServer = async () => {
  const server = new AtlasMCPServer();
  await server.start();
};
```

**Claude Desktop Configuration:**
```json
// claude_desktop_config.json
{
  "mcpServers": {
    "atlas-desktop": {
      "command": "node",
      "args": ["C:/Users/Nxiss/OneDrive/Desktop/nova-desktop/dist/mcp-server.js"]
    }
  }
}
```

**Tasks:**
- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Create MCP server that exposes Atlas tools
- [ ] Map Atlas tool definitions to MCP JSON Schema
- [ ] Expose file system as MCP resources
- [ ] Expose memory/knowledge as MCP resources
- [ ] Create standalone MCP server entry point
- [ ] Test with Claude Desktop
- [ ] Document MCP connection in README

---

### P2-2: MCP Client for External Servers

**Source:** Anthropic MCP research  
**Effort:** 1 week  
**Dependencies:** P2-1

**Files to Create:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/mcp/client.ts` | ~400 | Connect to external MCP servers |
| `src/main/mcp/server-registry.ts` | ~200 | Manage connected servers |

**Implementation:**
```typescript
import { Client } from '@modelcontextprotocol/sdk/client';

interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, { server: string; tool: MCPTool }> = new Map();
  
  async connect(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
    });
    
    const client = new Client({ name: 'atlas-client', version: '1.0.0' }, {});
    await client.connect(transport);
    
    this.clients.set(config.name, client);
    
    // Import tools from remote server
    const { tools } = await client.listTools();
    for (const tool of tools) {
      this.tools.set(`${config.name}:${tool.name}`, { server: config.name, tool });
    }
    
    logger.info(`Connected to MCP server: ${config.name}`, { tools: tools.length });
  }
  
  async callTool(toolId: string, args: unknown): Promise<unknown> {
    const [serverName, toolName] = toolId.split(':');
    const client = this.clients.get(serverName);
    
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }
    
    return client.callTool({ name: toolName, arguments: args });
  }
  
  getAvailableTools(): ToolDefinition[] {
    return Array.from(this.tools.entries()).map(([id, { tool }]) => ({
      name: id,
      description: `[MCP] ${tool.description}`,
      parameters: tool.inputSchema
    }));
  }
}

export const getMCPClientManager = singleton(() => new MCPClientManager());
```

**Useful Community MCP Servers:**
```typescript
const COMMUNITY_SERVERS: MCPServerConfig[] = [
  {
    name: 'github',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  },
  {
    name: 'notion',
    command: 'npx',
    args: ['@modelcontextprotocol/server-notion'],
    env: { NOTION_TOKEN: process.env.NOTION_TOKEN }
  },
  {
    name: 'puppeteer',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer']
  }
];
```

**Tasks:**
- [ ] Implement MCP client
- [ ] Add server configuration UI
- [ ] Connect to GitHub MCP server
- [ ] Connect to Notion MCP server
- [ ] Merge remote tools with local tools
- [ ] Handle server disconnection gracefully
- [ ] Add reconnection logic

---

## Phase 3: Trading Intelligence (Weeks 4-6)

### P3-1: Market Regime Detection

**Source:** Two Sigma research  
**Effort:** 2 weeks

**Architecture:**
```
Historical Price Data
        ↓
  ┌─────────────────────────────────────────┐
  │         Feature Extraction               │
  │  ┌─────────┬──────────┬──────────────┐  │
  │  │ Trend   │ Volatil- │ Momentum     │  │
  │  │ (SMA)   │ ity (ATR)│ (ROC)        │  │
  │  └─────────┴──────────┴──────────────┘  │
  │  ┌─────────┬──────────────────────────┐  │
  │  │ Correl- │ Volume Profile           │  │
  │  │ ation   │                          │  │
  │  └─────────┴──────────────────────────┘  │
  └─────────────────────────────────────────┘
        ↓
  Gaussian Mixture Model (4 clusters)
        ↓
  ┌─────────────────────────────────────────┐
  │         Regime Classification            │
  │                                          │
  │   BULL    │   BEAR    │ SIDEWAYS │ VOLATILE │
  │  Trending │  Trending │  Range   │  High    │
  │    Up     │   Down    │  Bound   │  Vol     │
  └─────────────────────────────────────────┘
        ↓
  Strategy Parameter Adjustment
```

**Files to Create:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/trading/regime/types.ts` | ~100 | Regime types |
| `src/main/trading/regime/feature-extractor.ts` | ~300 | Market feature calculation |
| `src/main/trading/regime/gmm-classifier.ts` | ~400 | Gaussian Mixture Model |
| `src/main/trading/regime/strategy-adapter.ts` | ~250 | Adjust params per regime |
| `src/main/trading/regime/index.ts` | ~50 | Module exports |

**Key Types:**
```typescript
type RegimeName = 'bull' | 'bear' | 'sideways' | 'volatile';

interface MarketRegime {
  name: RegimeName;
  confidence: number;
  startTime: number;
  indicators: {
    trend: number;        // -1 (strong down) to +1 (strong up)
    volatility: number;   // Percentile rank (0-100)
    correlation: number;  // Cross-asset correlation
    momentum: number;     // Recent returns
    volumeProfile: number; // Volume vs average
  };
}

interface RegimeStrategyParams {
  regime: RegimeName;
  positionSizeMultiplier: number;  // 0.5 - 1.5
  stopLossATRMultiplier: number;   // 1.0 - 3.0
  takeProfitATRMultiplier: number; // 1.5 - 4.0
  maxConcurrentPositions: number;
  allowedDirections: ('long' | 'short')[];
}

const REGIME_PARAMS: Record<RegimeName, RegimeStrategyParams> = {
  bull: {
    regime: 'bull',
    positionSizeMultiplier: 1.2,
    stopLossATRMultiplier: 2.0,
    takeProfitATRMultiplier: 3.0,
    maxConcurrentPositions: 5,
    allowedDirections: ['long']  // Favor longs in bull
  },
  bear: {
    regime: 'bear',
    positionSizeMultiplier: 0.8,
    stopLossATRMultiplier: 1.5,
    takeProfitATRMultiplier: 2.5,
    maxConcurrentPositions: 3,
    allowedDirections: ['short', 'long']
  },
  sideways: {
    regime: 'sideways',
    positionSizeMultiplier: 0.6,
    stopLossATRMultiplier: 1.0,
    takeProfitATRMultiplier: 1.5,
    maxConcurrentPositions: 4,
    allowedDirections: ['long', 'short']  // Mean reversion both ways
  },
  volatile: {
    regime: 'volatile',
    positionSizeMultiplier: 0.5,
    stopLossATRMultiplier: 2.5,
    takeProfitATRMultiplier: 4.0,
    maxConcurrentPositions: 2,
    allowedDirections: ['long', 'short']
  }
};
```

**Tasks:**
- [ ] Implement feature extraction (trend, volatility, correlation, momentum)
- [ ] Implement Gaussian Mixture Model with 4 clusters
- [ ] Train on historical data (or use pre-trained weights)
- [ ] Create strategy parameter lookup per regime
- [ ] Integrate with position sizing
- [ ] Add regime to trading dashboard
- [ ] Voice announce regime changes: "Market regime shifted to volatile"

---

### P3-2: Event-Driven Trading Pipeline

**Source:** HFT research  
**Effort:** 1 week

**Implementation:** See detailed spec in copilot-instructions.md

**Tasks:**
- [ ] Create central event bus
- [ ] Define all trading event types
- [ ] Migrate existing trading flow to event-driven
- [ ] Add comprehensive logging per event
- [ ] Add latency measurement per stage

---

### P3-3: Functional Signal Composition

**Source:** Jane Street research  
**Effort:** 1 week

**Implementation:** See detailed spec in copilot-instructions.md

**Tasks:**
- [ ] Create `pipe` utility for signal composition
- [ ] Create basic signal generators
- [ ] Create signal filters
- [ ] Create signal combiners
- [ ] Document signal composition patterns

---

## Phase 4: Browser Agent Enhancements (Weeks 6-8)

### P4-1: Natural Language Browser API

**Source:** Browserbase Stagehand research  
**Effort:** 2 weeks

**Tasks:**
- [ ] Create NL command parser using LLM
- [ ] Map NL commands to browser actions
- [ ] Create schema-based extraction
- [ ] Add fallback to detailed automation
- [ ] Integrate with voice commands

---

### P4-2: Workflow DSL

**Source:** Adept AI AWL research  
**Effort:** 2 weeks

**Tasks:**
- [ ] Design Atlas Workflow Language syntax
- [ ] Implement parser
- [ ] Create workflow executor
- [ ] Build library of common workflows
- [ ] Add NL → workflow generation
- [ ] Create workflow editor UI

---

### P4-3: Enhanced Session Persistence

**Source:** MultiOn research  
**Effort:** 1 week

**Tasks:**
- [ ] Add session metadata tracking
- [ ] Implement session validation
- [ ] Add auto-refresh for OAuth sessions
- [ ] Create session list UI
- [ ] Add voice commands for session management

---

## Phase 5: Intelligence & Learning (Weeks 8-12)

### P5-1: Sensor Fusion Context Engine

**Source:** Anduril Lattice research  
**Effort:** 4 weeks

**Key Concept:** "Decision Points, Not Noise"

Instead of surfacing every piece of information, identify what requires user decision:

```typescript
interface DecisionPoint {
  id: string;
  summary: string;
  options: Array<{ label: string; action: () => Promise<void> }>;
  recommendation: number;  // Index of recommended option
  urgency: 'immediate' | 'soon' | 'when-convenient';
  context: string[];       // Supporting information
}

// Example decision points:
// - "Your ETH position is down 5%. Close or hold?"
// - "Meeting in 15 minutes. Finish this task or save draft?"
// - "Git push failed. Retry or stash changes?"
```

**Tasks:**
- [ ] Define all context source interfaces
- [ ] Build context collectors for each source
- [ ] Implement fusion algorithm
- [ ] Create decision point extraction
- [ ] Build noise filter
- [ ] Add decision point UI component

---

### P5-2: RLHF Feedback Collection

**Source:** Scale AI research  
**Effort:** 3 weeks

**Tasks:**
- [ ] Implement implicit feedback detection
- [ ] Add feedback widget after responses
- [ ] Build feedback storage and analysis
- [ ] Create adjustment suggestions
- [ ] Add feedback dashboard

---

### P5-3: Edge-First Architecture Hardening

**Source:** Shield AI research  
**Effort:** 2 weeks

**Tasks:**
- [ ] Create EdgeFirstOrchestrator
- [ ] Configure thresholds per service
- [ ] Pre-load offline providers
- [ ] Add connectivity status indicator
- [ ] Test offline operation

---

## Phase 6: Codebase Intelligence (Weeks 10-12)

### P6-1: Codebase Indexing

**Source:** Cursor AI research  
**Effort:** 3 weeks

**Tasks:**
- [ ] Implement TypeScript/JavaScript parser
- [ ] Extract symbols, imports, exports
- [ ] Build reference graph
- [ ] Add file watcher for incremental updates
- [ ] Create context builder for LLM

---

### P6-2: Tiered Model Selection

**Source:** Replit research  
**Effort:** 1 week

**Tasks:**
- [ ] Define model tiers
- [ ] Implement complexity estimation
- [ ] Integrate with smart router
- [ ] Add cost tracking

---

## Progress Tracker

### Phase 0: Quick Wins [PENDING]
- [ ] QW-1: Deepgram enhanced config
- [ ] QW-2: Cartesia optimization
- [ ] QW-3: Alpaca paper trading
- [ ] QW-4: Project rules (.atlas-rules)
- [ ] QW-5: Trading kill switches

### Phase 1: Voice & Emotion [PENDING]
- [ ] P1-1: Prosody emotion detection
- [ ] P1-2: Expressive TTS response

### Phase 2: MCP Protocol [PENDING]
- [ ] P2-1: MCP server implementation
- [ ] P2-2: MCP client for external servers

### Phase 3: Trading Intelligence [PENDING]
- [ ] P3-1: Market regime detection
- [ ] P3-2: Event-driven pipeline
- [ ] P3-3: Functional signal composition

### Phase 4: Browser Agent [PENDING]
- [ ] P4-1: Natural language browser API
- [ ] P4-2: Workflow DSL
- [ ] P4-3: Enhanced session persistence

### Phase 5: Intelligence & Learning [PENDING]
- [ ] P5-1: Sensor fusion context engine
- [ ] P5-2: RLHF feedback collection
- [ ] P5-3: Edge-first architecture

### Phase 6: Codebase Intelligence [PENDING]
- [ ] P6-1: Codebase indexing
- [ ] P6-2: Tiered model selection

---

## Research Source Reference

| Company | Key Learnings | Phase |
|---------|---------------|-------|
| Anduril Lattice | Sensor fusion, decision points not noise | P5-1 |
| Shield AI | Edge-first autonomy, graceful degradation | P5-3 |
| Scale AI | RLHF feedback loops, implicit signals | P5-2 |
| Hume AI | Prosody-based emotion detection | P1-1 |
| Deepgram | Diarization, utterances, custom vocabulary | QW-1 |
| Cartesia | Emotion-adaptive TTS, prosody controls | QW-2, P1-2 |
| Anthropic MCP | Protocol standard, tool/resource exposure | P2-1, P2-2 |
| Browserbase | Natural language browser API | P4-1 |
| Adept AI | Workflow DSL | P4-2 |
| MultiOn | Session persistence | P4-3 |
| Two Sigma | GMM regime detection | P3-1 |
| Jane Street | Functional signal composition | P3-3 |
| HFT | Event-driven pipeline, kill switches | P3-2, QW-5 |
| Alpaca | Paper trading integration | QW-3 |
| Cursor | Codebase indexing, project rules | P6-1, QW-4 |
| Replit | Tiered model selection | P6-2 |

---

**Full research document:** `docs/research/ATLAS-COMPANY-RESEARCH.md`
