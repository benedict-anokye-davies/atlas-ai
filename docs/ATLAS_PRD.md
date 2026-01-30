# Atlas Desktop - Product Requirements Document (PRD)

**Version:** 0.3.0  
**Last Updated:** January 30, 2026  
**Author:** Kimi K2.5 (Atlas AI)  
**Status:** Living Document

---

## Executive Summary

Atlas is a voice-first AI desktop assistant that serves as a **friend first, assistant second**. Unlike traditional productivity tools, Atlas is designed to be a supportive presence that knows the user, remembers their struggles, and helps without judgment. Built on Electron + React + TypeScript, Atlas combines real-time voice interaction with advanced AI capabilities, multi-channel communication, and a stunning 3D visual interface.

### Key Differentiators

- **Voice-First:** Natural conversation flow with wake word detection, VAD, and real-time TTS
- **Multi-Channel:** Unified interface for WhatsApp, Telegram, Discord, iMessage, and WebChat
- **Agent-Powered:** Advanced tool system with filesystem, terminal, browser automation, and more
- **Memory:** Persistent conversation history with semantic search via LanceDB
- **Visual:** 35,000-particle 3D orb that reacts to voice and emotions
- **Extensible:** Skills platform for custom capabilities

---

## Current State Analysis

### ✅ Phase 1: Core Infrastructure (COMPLETE)

- [x] Voice pipeline (Porcupine wake word → Silero VAD → Deepgram STT → LLM → ElevenLabs TTS)
- [x] Provider failover with circuit breakers (Deepgram↔Vosk, Fireworks↔OpenRouter, ElevenLabs↔Piper)
- [x] 3D Orb visualization (Three.js, 35k particles, Aizawa attractor)
- [x] Basic agent tools (filesystem, terminal, git, process management)
- [x] Conversation memory (LanceDB vectors + SQLite)
- [x] IPC communication (60+ channels)
- [x] Security layer (input validation, rate limiting, sandboxing)

### 🚧 Partially Implemented Features

#### Multi-Channel Communication (Phase 2 - 40% Complete)

**Current Status:** Adapters exist but not fully integrated

| Channel  | Status         | Location                                | Notes                                       |
| -------- | -------------- | --------------------------------------- | ------------------------------------------- |
| WhatsApp | 🟡 Partial     | `src/main/channels/whatsapp-adapter.ts` | Baileys imported, needs gateway integration |
| Telegram | 🟡 Partial     | `src/main/channels/telegram-adapter.ts` | grammY imported, needs bot setup            |
| Discord  | 🟡 Partial     | `src/main/channels/discord-adapter.ts`  | discord.js imported, needs gateway          |
| Slack    | 🟡 Partial     | `src/main/channels/slack-adapter.ts`    | Bolt SDK imported                           |
| iMessage | 🔴 Not Started | -                                       | macOS only, needs native module             |
| WebChat  | 🟡 Partial     | `web-ui/`                               | Separate React app exists                   |
| Gateway  | 🟡 Partial     | `src/main/gateway/`                     | WebSocket server skeleton exists            |

**Blockers:**

- Gateway architecture needs completion for unified message routing
- Session management not implemented
- No message persistence across channels

#### Advanced Tools (Phase 3 - 30% Complete)

| Tool            | Status         | Location                                             | Priority |
| --------------- | -------------- | ---------------------------------------------------- | -------- |
| Browser Control | 🟡 Partial     | `src/main/browser/`, `src/main/agent/browser-agent/` | HIGH     |
| Web Search      | 🔴 Not Started | -                                                    | HIGH     |
| Web Fetch       | 🔴 Not Started | -                                                    | HIGH     |
| Canvas/A2UI     | 🟡 Partial     | `src/main/canvas/`                                   | Medium   |
| Cron/Scheduling | 🟡 Partial     | `src/main/automation/`                               | Medium   |
| Image Analysis  | 🟡 Partial     | `src/main/multimodal/`                               | Medium   |

**Blockers:**

- Browser automation needs CDP integration completion
- Web search requires Brave Search API integration
- Canvas needs A2UI protocol implementation

#### Banking & Finance (Extended Feature - 60% Complete)

**Current Status:** Core banking infrastructure exists

| Feature               | Status     | Location                                 |
| --------------------- | ---------- | ---------------------------------------- |
| TrueLayer Integration | 🟡 Partial | `src/main/banking/`                      |
| Plaid Integration     | 🟡 Partial | `src/main/banking/plaid-client.ts`       |
| Transaction Search    | ✅ Done    | `src/main/banking/transaction-search.ts` |
| Budget Management     | 🟡 Partial | `src/main/banking/budget-manager.ts`     |
| Payment Service       | 🟡 Partial | `src/main/banking/payment-service.ts`    |
| Balance Alerts        | 🟡 Partial | `src/main/banking/balance-alerts.ts`     |

**Blockers:**

- Banking UI not integrated into main dashboard
- Payment execution needs security review
- Transaction categorization needs ML model

#### Trading System (Extended Feature - 50% Complete)

**Current Status:** Core engine exists, needs integration

| Feature            | Status         | Location                                |
| ------------------ | -------------- | --------------------------------------- |
| CCXT Integration   | ✅ Done        | `src/main/trading/ccxt-client.ts`       |
| Strategy Engine    | 🟡 Partial     | `src/main/trading/strategy-engine.ts`   |
| Risk Management    | 🟡 Partial     | `src/main/trading/risk-manager.ts`      |
| Order Execution    | 🟡 Partial     | `src/main/trading/order-manager.ts`     |
| Portfolio Tracking | 🟡 Partial     | `src/main/trading/portfolio-manager.ts` |
| Backtesting        | 🔴 Not Started | -                                       |

**Blockers:**

- Trading UI needs completion (`src/renderer/components/TradingDashboard.tsx` exists but not wired)
- Paper trading mode not implemented
- Strategy marketplace not started

#### Career Assistant (Extended Feature - 70% Complete)

**Current Status:** Most features implemented

| Feature              | Status     | Location                                 |
| -------------------- | ---------- | ---------------------------------------- |
| CV Optimizer         | ✅ Done    | `src/main/career/cv-optimizer.ts`        |
| Job Search           | ✅ Done    | `src/main/career/job-search-engine.ts`   |
| Skills Gap Analysis  | ✅ Done    | `src/main/career/skills-gap-analyzer.ts` |
| Interview Prep       | ✅ Done    | `src/main/career/interview-prep.ts`      |
| Application Tracking | 🟡 Partial | `src/main/career/application-tracker.ts` |

**Blockers:**

- UI components exist but not integrated into main app
- LinkedIn integration needs OAuth

#### Code Intelligence (Extended Feature - 65% Complete)

**Current Status:** Core functionality implemented

| Feature           | Status     | Location                                         |
| ----------------- | ---------- | ------------------------------------------------ |
| Codebase Indexing | ✅ Done    | `src/main/code-intelligence/codebase-indexer.ts` |
| Context Builder   | ✅ Done    | `src/main/code-intelligence/context-builder.ts`  |
| Iterative Coder   | ✅ Done    | `src/main/code-intelligence/iterative-coder.ts`  |
| AST Analysis      | 🟡 Partial | `src/main/code-intelligence/`                    |
| Multi-file Edits  | 🟡 Partial | `src/main/code-intelligence/`                    |

**Blockers:**

- Needs integration with agent tool system
- UI for code review not complete

#### Personality & Context (Extended Feature - 80% Complete)

**Current Status:** Advanced personality system implemented

| Feature               | Status     | Location                                       |
| --------------------- | ---------- | ---------------------------------------------- |
| Persona Manager       | ✅ Done    | `src/main/personality/persona-manager.ts`      |
| Context Switcher      | ✅ Done    | `src/main/personality/context-switcher.ts`     |
| Prosody Analysis      | ✅ Done    | `src/main/voice/prosody/`                      |
| Emotion Detection     | ✅ Done    | `src/main/voice/prosody/emotion-classifier.ts` |
| Proactive Suggestions | 🟡 Partial | `src/main/proactive/`                          |

---

## Priority Roadmap

### P0: Critical (Next 2 Weeks)

#### 1. Multi-Channel Gateway Completion

**Objective:** Enable Atlas to send/receive messages across all channels

**Requirements:**

- Complete WebSocket gateway server (`src/main/gateway/`)
- Implement session management per channel
- Add message routing logic
- Create unified inbox UI

**Technical Specs:**

```typescript
// Gateway session interface
interface GatewaySession {
  id: string;
  channel: 'whatsapp' | 'telegram' | 'discord' | 'slack' | 'imessage' | 'web';
  userId: string;
  socket: WebSocket;
  status: 'active' | 'inactive' | 'error';
  lastActivity: number;
  metadata: ChannelMetadata;
}

// Message routing
interface MessageRouter {
  route(message: IncomingMessage): Promise<RouteDecision>;
  broadcast(response: OutgoingMessage): Promise<void>;
}
```

**Acceptance Criteria:**

- [ ] Messages from any channel appear in unified inbox
- [ ] Atlas can respond to any channel
- [ ] Session persistence across reconnections
- [ ] Rate limiting per channel

#### 2. Browser Automation Completion

**Objective:** Enable Atlas to control browser for web tasks

**Requirements:**

- Complete CDP (Chrome DevTools Protocol) integration
- Implement browser agent with predictive actions
- Add screenshot and snapshot capabilities
- Create browser UI overlay

**Technical Specs:**

```typescript
// Browser tool interface
interface BrowserTool extends AgentTool {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  evaluate(script: string): Promise<any>;
  getContent(): Promise<string>;
}

// Predictive action engine
interface PredictiveEngine {
  predictNextAction(currentState: PageState): Promise<PredictedAction>;
  learnFromSuccess(action: Action, outcome: Outcome): void;
}
```

**Acceptance Criteria:**

- [ ] Can navigate to any URL
- [ ] Can interact with forms and buttons
- [ ] Can extract content from pages
- [ ] Can take screenshots for verification
- [ ] Predictive engine suggests next actions

#### 3. Web Search & Fetch

**Objective:** Enable Atlas to search and fetch web content

**Requirements:**

- Integrate Brave Search API
- Implement URL content extraction
- Add response caching
- Create search results UI

**Technical Specs:**

```typescript
// Web search tool
interface WebSearchTool extends AgentTool {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  timestamp: number;
}
```

**Acceptance Criteria:**

- [ ] Can search web and return results
- [ ] Can fetch and extract content from URLs
- [ ] Results cached for 1 hour
- [ ] Respects robots.txt

### P1: High Priority (Next 4 Weeks)

#### 4. Skills Platform Foundation

**Objective:** Enable third-party skills to extend Atlas

**Requirements:**

- Implement SKILL.md parser
- Create skill registry
- Add skill installation/management
- Build skills marketplace UI

**Technical Specs:**

```typescript
// Skill definition
interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: AgentTool[];
  gating: GatingRequirements;
  entryPoint: string;
}

interface GatingRequirements {
  binaries?: string[];
  env?: Record<string, string>;
  config?: Record<string, ConfigRequirement>;
}
```

#### 5. Node System (Companion Devices)

**Objective:** Connect mobile devices as Atlas nodes

**Requirements:**

- Implement node protocol over WebSocket
- Add device pairing and approval
- Enable camera/screen capture from nodes
- Create node management UI

**Technical Specs:**

```typescript
// Node interface
interface AtlasNode {
  id: string;
  name: string;
  type: 'ios' | 'android' | 'macos' | 'web';
  capabilities: NodeCapability[];
  socket: WebSocket;
  status: NodeStatus;
}

type NodeCapability = 'camera' | 'microphone' | 'screen' | 'location' | 'notifications';
```

#### 6. Canvas/A2UI Visual Workspace

**Objective:** Enable Atlas to create visual content

**Requirements:**

- Complete HTML rendering surface
- Implement A2UI protocol
- Add screenshot/snapshot capture
- Create canvas UI component

### P2: Medium Priority (Next 8 Weeks)

#### 7. Cron & Scheduling

**Objective:** Enable background task automation

**Requirements:**

- Implement cron job management
- Add scheduled message support
- Create workflow scheduler UI
- Add wakeup/heartbeat system

#### 8. Multi-Agent System

**Objective:** Enable multiple agent instances

**Requirements:**

- Implement session isolation
- Add agent routing logic
- Create agent-to-agent communication
- Add Docker sandboxing

#### 9. Security & Safety Enhancements

**Objective:** Harden Atlas for production use

**Requirements:**

- Implement tool profiles (allowlist/denylist)
- Add per-command approval system
- Create audit logging
- Add DM pairing for unknown senders

#### 10. Platform Expansion

**Objective:** Extend Atlas to other platforms

**Requirements:**

- macOS menu bar app
- iOS companion app (node mode)
- Android companion app (node mode)
- Linux systemd service

---

## Technical Debt & Improvements

### Code Quality

#### Documentation Gaps

- [ ] Add JSDoc to all public methods (currently ~60% complete)
- [ ] Create API documentation for all IPC channels
- [ ] Document all tool interfaces
- [ ] Add architecture decision records (ADRs)

#### Testing

- [ ] Increase test coverage from ~45% to 80%
- [ ] Add integration tests for voice pipeline
- [ ] Add E2E tests for critical user flows
- [ ] Add performance benchmarks

#### Refactoring

- [ ] Extract common provider logic into base classes
- [ ] Standardize error handling across all modules
- [ ] Implement proper dependency injection
- [ ] Reduce preload.ts size (currently 3,500+ lines)

### Performance

#### Startup Optimization

- [ ] Implement module lazy loading
- [ ] Add connection warmup
- [ ] Optimize bundle size (currently 411MB)
- [ ] Add startup profiler results to CI

#### Runtime Optimization

- [ ] Add response caching for repeated queries
- [ ] Implement adaptive particle count based on GPU
- [ ] Add memory pressure handling
- [ ] Optimize LanceDB queries

### Infrastructure

#### Build & CI

- [ ] Fix Windows build (onnxruntime-common issue resolved ✅)
- [ ] Add macOS notarization
- [ ] Implement auto-updater
- [ ] Add release automation

#### Monitoring

- [ ] Add error tracking (Sentry integration)
- [ ] Add usage analytics
- [ ] Add performance monitoring
- [ ] Create health check endpoint

---

## UI/UX Improvements

### Dashboard Redesign

**Current Issues:**

- Too many panels, cluttered interface
- Inconsistent styling across components
- Missing mobile-responsive design

**Requirements:**

- [ ] Implement unified dashboard layout
- [ ] Add customizable widgets
- [ ] Create mobile-responsive design
- [ ] Add dark/light theme toggle
- [ ] Implement gesture controls

### Chat Interface

**Current Issues:**

- Chat UI exists but not integrated with voice
- Missing rich message types
- No message threading

**Requirements:**

- [ ] Integrate chat with voice pipeline
- [ ] Add rich message types (images, files, code)
- [ ] Implement message threading
- [ ] Add message search
- [ ] Create conversation export

### Orb Visualization

**Current Issues:**

- Orb is beautiful but needs more interactivity
- Missing emotion-based color transitions
- No user-customizable themes

**Requirements:**

- [ ] Add emotion-based color transitions
- [ ] Implement user-customizable themes
- [ ] Add particle interaction on click/hover
- [ ] Create ambient mode (minimal UI)
- [ ] Add fullscreen orb mode

---

## API Integrations Needed

### High Priority

| Service      | Purpose         | Status         | API Key Required |
| ------------ | --------------- | -------------- | ---------------- |
| Brave Search | Web search      | 🔴 Not Started | Yes              |
| Twilio       | SMS/Voice       | 🟡 Partial     | Yes              |
| TrueLayer    | Banking (UK/EU) | 🟡 Partial     | Yes              |
| Plaid        | Banking (US)    | 🟡 Partial     | Yes              |

### Medium Priority

| Service | Purpose          | Status         | API Key Required |
| ------- | ---------------- | -------------- | ---------------- |
| Spotify | Music control    | 🟡 Partial     | Yes              |
| GitHub  | Code integration | 🟡 Partial     | Yes              |
| Notion  | Notes sync       | 🔴 Not Started | Yes              |
| Linear  | Task management  | 🔴 Not Started | Yes              |

### Low Priority

| Service  | Purpose            | Status         | API Key Required |
| -------- | ------------------ | -------------- | ---------------- |
| Figma    | Design integration | 🔴 Not Started | Yes              |
| Slack    | Full integration   | 🟡 Partial     | Yes              |
| Discord  | Full integration   | 🟡 Partial     | Yes              |
| Telegram | Full integration   | 🟡 Partial     | Yes              |

---

## Success Metrics

### User Engagement

- **Daily Active Users (DAU):** Target 100+ by end of Q2
- **Session Duration:** Target 15+ minutes average
- **Voice Interactions:** Target 50+ per user per day
- **Message Volume:** Target 100+ messages per user per day

### Performance

- **Cold Startup:** <3 seconds (currently 2.5s ✅)
- **Wake Word Detection:** <200ms (currently 150ms ✅)
- **STT Latency:** <300ms (currently 250ms ✅)
- **LLM First Token:** <2 seconds (currently 1.5s ✅)
- **Memory Usage:** <500MB (currently 350MB ✅)

### Reliability

- **Uptime:** 99.5% target
- **Crash Rate:** <0.1% per session
- **Provider Failover:** <1 second
- **Error Recovery:** 95% automatic recovery rate

### Quality

- **Test Coverage:** 80% (currently ~45%)
- **Code Documentation:** 100% public APIs
- **User Satisfaction:** NPS >50

---

## Risk Assessment

### High Risk

| Risk                           | Impact              | Mitigation                                      |
| ------------------------------ | ------------------- | ----------------------------------------------- |
| Native module bundling issues  | Build failures      | Keep asarUnpack updated, test builds on CI      |
| Memory leaks in voice pipeline | Crashes             | Implement strict cleanup, add memory monitoring |
| API rate limiting              | Service degradation | Implement circuit breakers, add caching         |
| Security vulnerabilities       | Data breaches       | Regular audits, sandboxing, input validation    |

### Medium Risk

| Risk                           | Impact          | Mitigation                                    |
| ------------------------------ | --------------- | --------------------------------------------- |
| Third-party API changes        | Broken features | Abstract providers, implement fallbacks       |
| Electron version compatibility | Build issues    | Pin versions, test upgrades thoroughly        |
| Cross-platform differences     | Inconsistent UX | Test on all platforms, use platform detection |
| User data privacy concerns     | Legal issues    | GDPR compliance, local-first storage          |

### Low Risk

| Risk                           | Impact           | Mitigation                                |
| ------------------------------ | ---------------- | ----------------------------------------- |
| Dependency vulnerabilities     | Security issues  | Automated scanning, regular updates       |
| UI performance on low-end GPUs | Poor UX          | GPU tier detection, adaptive quality      |
| Voice recognition accuracy     | User frustration | Multiple STT providers, custom wake words |

---

## Appendix

### A. File Structure Reference

```
src/
├── main/                          # Main process (Node.js)
│   ├── index.ts                   # Entry point (~1400 lines)
│   ├── preload.ts                 # IPC bridge (~3500 lines) ⚠️ Too large
│   ├── atlas-core.ts              # Core orchestrator
│   ├── voice/                     # Voice pipeline
│   │   ├── voice-pipeline.ts      # Central orchestrator
│   │   ├── wake-word.ts           # Porcupine detection
│   │   ├── vad.ts                 # Silero VAD
│   │   └── prosody/               # Emotion detection
│   ├── stt/                       # Speech-to-text
│   │   ├── manager.ts             # Provider manager
│   │   ├── providers/             # Deepgram, Vosk
│   │   └── types.ts
│   ├── llm/                       # Language models
│   │   ├── manager.ts             # Provider manager
│   │   ├── providers/             # Fireworks, OpenRouter
│   │   └── types.ts
│   ├── tts/                       # Text-to-speech
│   │   ├── manager.ts             # Provider manager
│   │   ├── providers/             # ElevenLabs, Cartesia, Piper
│   │   └── types.ts
│   ├── memory/                    # Storage & retrieval
│   │   ├── manager.ts             # Memory orchestrator
│   │   ├── vector-store.ts        # LanceDB
│   │   └── conversation-store.ts  # SQLite
│   ├── agent/                     # Tools & skills
│   │   ├── tools.ts               # Tool definitions
│   │   ├── skills/                # Skill registry
│   │   ├── browser-agent/         # Browser automation
│   │   └── workflow/              # Workflow engine
│   ├── channels/                  # Multi-channel adapters
│   │   ├── index.ts               # Channel manager
│   │   ├── whatsapp-adapter.ts    # Baileys
│   │   ├── telegram-adapter.ts    # grammY
│   │   ├── discord-adapter.ts     # discord.js
│   │   └── slack-adapter.ts       # Bolt
│   ├── gateway/                   # WebSocket gateway ⚠️ Incomplete
│   ├── browser/                   # Browser automation ⚠️ Incomplete
│   ├── canvas/                    # Visual workspace ⚠️ Incomplete
│   ├── banking/                   # Finance (extended)
│   ├── trading/                   # Trading (extended)
│   ├── career/                    # Career assistant (extended)
│   ├── code-intelligence/         # Code tools (extended)
│   ├── personality/               # Persona system (extended)
│   ├── security/                  # Security layer
│   ├── ipc/                       # IPC handlers
│   └── ...
├── renderer/                      # Renderer process (React)
│   ├── main.tsx                   # Entry point
│   ├── App.tsx                    # Root component
│   ├── ModernChatApp.tsx          # Chat interface
│   ├── PalantirApp.tsx            # Finance dashboard
│   ├── components/
│   │   ├── orb/                   # 3D visualization
│   │   ├── chat/                  # Chat components
│   │   ├── dashboard/             # Dashboard layout
│   │   ├── palantir/              # Finance widgets
│   │   └── ... (100+ components)
│   ├── hooks/                     # React hooks
│   └── stores/                    # Zustand stores
├── shared/                        # Shared code
│   └── types/                     # TypeScript interfaces
└── web-ui/                        # WebChat UI (separate app)
```

### B. Technology Stack

| Layer     | Technology     | Version | Purpose          |
| --------- | -------------- | ------- | ---------------- |
| Framework | Electron       | 28.1.0  | Desktop app      |
| UI        | React          | 18.2.0  | Component UI     |
| Language  | TypeScript     | 5.3.3   | Type safety      |
| Build     | Vite           | 5.0.10  | Bundling         |
| Test      | Vitest         | 1.1.0   | Testing          |
| 3D        | Three.js       | 0.160.0 | WebGL            |
| State     | Zustand        | 4.4.7   | State management |
| DB        | LanceDB        | 0.23.0  | Vector store     |
| DB        | better-sqlite3 | 12.6.2  | SQLite           |
| Wake Word | Porcupine      | 4.0.1   | "Hey Atlas"      |
| VAD       | Silero         | -       | Speech detection |
| STT       | Deepgram       | 4.11.3  | Cloud STT        |
| STT       | Vosk           | 1.1.1   | Offline STT      |
| LLM       | Fireworks      | -       | Primary LLM      |
| LLM       | OpenRouter     | -       | Fallback LLM     |
| TTS       | ElevenLabs     | -       | Primary TTS      |
| TTS       | Piper          | -       | Offline TTS      |

### C. Dependencies Analysis

**Total Dependencies:** 156 (58 prod + 98 dev)
**Security Updates Needed:** Run `npm audit` regularly
**Size Concerns:**

- onnxruntime-node: ~200MB
- better-sqlite3: ~50MB
- sharp: ~30MB

**Recommendations:**

- Consider lazy loading for heavy native modules
- Evaluate if all dependencies are necessary
- Pin versions for native modules

---

## Conclusion

Atlas is a sophisticated voice-first AI assistant with a solid foundation and ambitious roadmap. The core infrastructure (Phase 1) is complete and stable. The primary focus for the next 2 weeks should be:

1. **Multi-Channel Gateway** - Enable Atlas to communicate across all messaging platforms
2. **Browser Automation** - Complete the CDP integration for web tasks
3. **Web Search** - Add Brave Search for knowledge retrieval

With these three features complete, Atlas will be ready for broader user testing and can begin the march toward v1.0. The extended features (banking, trading, career) provide significant value but should be prioritized after the core multi-channel experience is solid.

**Powered by Kimi K2.5** - Atlas's AI brain and your friendly assistant for making Atlas great. 🚀

---

_This document is a living specification. Update it as features are completed, priorities shift, or new requirements emerge._
