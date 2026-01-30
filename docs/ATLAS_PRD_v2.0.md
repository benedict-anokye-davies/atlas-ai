# Atlas Desktop v2.0 - Product Requirements Document (PRD)

**Version:** 2.0.0  
**Last Updated:** January 30, 2026  
**Author:** Kimi K2.5 (Atlas AI)  
**Status:** Strategic Roadmap  
**Vision:** _Atlas becomes a truly autonomous, self-improving AI companion that anticipates needs, learns from every interaction, and seamlessly integrates into every aspect of digital life._

---

## Executive Summary

Atlas v2.0 represents a paradigm shift from "voice-first assistant" to "autonomous AI companion." While v1.0 focused on building a solid foundation with voice interaction, multi-channel communication, and basic agent tools, v2.0 introduces **autonomy**, **self-improvement**, **proactive intelligence**, and **deep system integration**.

### Core Philosophy Shift

**v1.0:** "Ask Atlas to do things"  
**v2.0:** "Atlas knows what you need before you ask"

### Key Differentiators for v2.0

1. **Autonomous Operation** - Atlas runs background tasks, monitors systems, and takes initiative
2. **Self-Improvement Loop** - Learns from every interaction, optimizes its own code, expands capabilities
3. **Predictive Intelligence** - Anticipates user needs based on context, patterns, and goals
4. **Deep System Integration** - Native OS integration, kernel-level automation, hardware control
5. **Multi-Agent Swarm** - Multiple specialized Atlas instances collaborating on complex tasks
6. **Continuous Learning** - Real-time learning from web, documents, conversations, and user feedback
7. **Emotional Intelligence** - Advanced prosody analysis, mood detection, empathetic responses

---

## Current State (Post-v1.0 Fixes)

### ✅ Completed in v1.0 Fixes

**Infrastructure (COMPLETE):**

- ✅ Voice pipeline with wake word, VAD, STT, LLM, TTS
- ✅ 3D Orb visualization (35k particles, emotion-reactive)
- ✅ Multi-channel gateway (WebSocket, session management)
- ✅ Channel adapters (WhatsApp, Telegram, Discord, Slack)
- ✅ Memory system (LanceDB vectors + SQLite)
- ✅ Web search with Brave Search API + caching
- ✅ Browser automation with CDP (Chrome DevTools Protocol)
- ✅ Agent tools (60+ tools across filesystem, terminal, git, etc.)
- ✅ Security layer (input validation, rate limiting, sandboxing)

**Fixed Critical TODOs:**

- ✅ Weather skill now uses real OpenWeatherMap API with geocoding
- ✅ Browser agent predictive engine has persistent storage for patterns
- ✅ Browser agent action compositor has persistent storage for macros
- ✅ All TypeScript compilation errors resolved
- ✅ Test suite passing (61 test files, ~45% coverage)

**Architecture Strengths:**

- Clean separation of concerns (main/renderer/preload)
- Provider pattern with circuit breakers for all external APIs
- Comprehensive IPC communication (60+ channels)
- Modular tool system with 60+ agent tools
- Event-driven architecture with EventEmitter
- Strong TypeScript typing throughout

---

## v2.0 Strategic Pillars

### Pillar 1: Autonomous Operation 🤖

**Objective:** Atlas operates independently, running background tasks, monitoring systems, and taking initiative without constant user prompting.

#### 1.1 Background Task Engine

**Current State:** Basic cron support exists but limited
**Target:** Full autonomous task management

**Requirements:**

- [ ] **Task Scheduler** - Advanced scheduling beyond cron (dependency chains, conditional execution, priority queues)
- [ ] **Background Workers** - Worker pool for parallel task execution
- [ ] **Resource Management** - CPU/memory-aware task scheduling
- [ ] **Persistence** - Task state survives restarts
- [ ] **Recovery** - Automatic retry with exponential backoff
- [ ] **Notifications** - Proactive alerts on task completion/failure

**Technical Spec:**

```typescript
interface AutonomousTask {
  id: string;
  name: string;
  type: 'monitor' | 'sync' | 'analyze' | 'action';
  schedule: TaskSchedule;
  dependencies: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  resources: ResourceRequirements;
  maxRetries: number;
  timeout: number;
  execute: () => Promise<TaskResult>;
}

interface TaskSchedule {
  type: 'interval' | 'cron' | 'event' | 'conditional';
  expression: string;
  timezone?: string;
  startTime?: number;
  endTime?: number;
}
```

**Use Cases:**

- Monitor stock prices and alert on thresholds
- Sync files across devices every hour
- Analyze codebase for security issues nightly
- Check email and summarize important messages every 30 minutes
- Monitor system health and optimize performance

#### 1.2 Context-Aware Automation

**Objective:** Atlas understands the user's current context (app, time, location, activity) and automates accordingly.

**Requirements:**

- [ ] **Screen Context Detection** - Know what app/website user is viewing
- [ ] **Activity Recognition** - Detect if user is coding, browsing, in meeting, etc.
- [ ] **Time-Based Behaviors** - Different automation for morning vs evening
- [ ] **Location Awareness** - Different behaviors at home vs office vs travel
- [ ] **Focus Detection** - Don't interrupt when user is in deep work

**Technical Implementation:**

```typescript
interface ContextProfile {
  timestamp: number;
  activeApplication: string;
  activeWindow: string;
  browserUrl?: string;
  activity: 'coding' | 'browsing' | 'meeting' | 'reading' | 'idle';
  focusLevel: 'deep' | 'normal' | 'distracted' | 'idle';
  location: 'home' | 'office' | 'travel' | 'unknown';
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

class ContextEngine {
  async detectCurrentContext(): Promise<ContextProfile>;
  async shouldInterrupt(): Promise<boolean>;
  async getRecommendedActions(): Promise<AutonomousTask[]>;
}
```

#### 1.3 Proactive Suggestions

**Objective:** Atlas suggests actions before user asks, based on patterns and goals.

**Requirements:**

- [ ] **Pattern Learning** - Learn user routines and suggest optimizations
- [ ] **Goal Tracking** - Track user goals and suggest next steps
- [ ] **Anomaly Detection** - Alert when something unusual happens
- [ ] **Predictive Alerts** - "You usually check email now" / "Stock hit your target"

**Examples:**

- "I noticed you always run `npm test` after editing test files. Want me to auto-run?"
- "Your meeting starts in 5 minutes. I've pulled up the agenda."
- "Bitcoin dropped below your alert price. Current: $42,300 (down 5%)"

---

### Pillar 2: Self-Improvement Loop 🔄

**Objective:** Atlas continuously improves itself by learning from interactions, optimizing code, and expanding capabilities automatically.

#### 2.1 Code Self-Optimization

**Requirements:**

- [ ] **Performance Monitoring** - Track execution times, identify bottlenecks
- [ ] **Auto-Profiling** - Profile slow functions and suggest optimizations
- [ ] **Hot Path Optimization** - JIT-style optimization for frequently used code
- [ ] **Memory Leak Detection** - Monitor and fix memory issues automatically
- [ ] **Self-Benchmarking** - Run benchmarks and track performance over time

**Technical Approach:**

```typescript
class SelfOptimizer {
  async analyzePerformance(): Promise<PerformanceReport>;
  async optimizeHotPaths(): Promise<OptimizationResult[]>;
  async detectMemoryLeaks(): Promise<LeakReport[]>;
  async suggestCodeImprovements(): Promise<CodeSuggestion[]>;
}
```

#### 2.2 Tool Auto-Generation

**Objective:** When Atlas encounters a new task, it can generate new tools automatically.

**Requirements:**

- [ ] **Need Detection** - Recognize when existing tools are insufficient
- [ ] **Tool Generation** - Generate new tool code based on requirements
- [ ] **Self-Testing** - Test generated tools in sandbox
- [ ] **Integration** - Auto-register new tools with the system
- [ ] **Documentation** - Generate JSDoc and usage examples

**Example Flow:**

1. User: "I need to convert Figma designs to React components"
2. Atlas detects no tool exists for this
3. Atlas generates `figma-to-react` tool using Figma API
4. Atlas tests tool with sample Figma file
5. Atlas registers tool and documents it
6. Atlas: "I've created a new tool for you. Try: 'Convert Figma file XYZ to React'"

#### 2.3 Learning from Feedback

**Requirements:**

- [ ] **Explicit Feedback** - Thumbs up/down on responses
- [ ] **Implicit Feedback** - Track if user followed suggestions
- [ ] **A/B Testing** - Test different approaches and learn what works
- [ ] **Preference Learning** - Learn user preferences over time
- [ ] **Model Fine-Tuning** - Use interactions to fine-tune LLM responses

---

### Pillar 3: Deep System Integration 🔌

**Objective:** Atlas integrates deeply with the operating system, hardware, and native applications.

#### 3.1 OS-Level Integration

**Requirements:**

- [ ] **Global Hotkeys** - System-wide keyboard shortcuts
- [ ] **System Tray** - Deep integration with OS tray/menu bar
- [ ] **Notifications** - Native OS notification system
- [ ] **File System Hooks** - Watch file changes in real-time
- [ ] **Process Management** - Monitor and control system processes
- [ ] **Window Management** - Control window positioning, sizing, focus

**Platform-Specific:**

- **macOS:** Menu bar app, Touch Bar support, Shortcuts integration
- **Windows:** System tray, Taskbar integration, Win32 API access
- **Linux:** systemd service, D-Bus integration, Wayland/X11 support

#### 3.2 Hardware Control

**Requirements:**

- [ ] **Audio Control** - System audio, microphone, speakers
- [ ] **Display Control** - Brightness, resolution, multiple monitors
- [ ] **Power Management** - Battery monitoring, sleep/wake control
- [ ] **Peripheral Control** - USB devices, Bluetooth, printers
- [ ] **Camera/Mic Access** - Direct hardware access for vision/voice

#### 3.3 Native App Integration

**Requirements:**

- [ ] **VS Code Extension** - Deep IDE integration
- [ ] **Browser Extension** - Chrome/Firefox/Brave extension
- [ ] **Slack/Discord Bot** - Native bot presence in apps
- [ ] **Spotify/Apple Music** - Music control integration
- [ ] **Calendar Apps** - Outlook, Google Calendar, Apple Calendar
- [ ] **Email Clients** - Gmail, Outlook, Apple Mail

---

### Pillar 4: Multi-Agent Swarm 🐝

**Objective:** Multiple specialized Atlas instances collaborate on complex tasks.

#### 4.1 Agent Specialization

**Agent Types:**

- **Coder Agent** - Specialized in code generation, review, debugging
- **Research Agent** - Specialized in web research, analysis, summarization
- **Creative Agent** - Specialized in writing, design, content creation
- **System Agent** - Specialized in system administration, DevOps
- **Data Agent** - Specialized in data analysis, visualization, SQL
- **Security Agent** - Specialized in security analysis, auditing

**Technical Spec:**

```typescript
interface SpecializedAgent {
  id: string;
  type: AgentType;
  capabilities: string[];
  llmConfig: LLMConfig; // Different models for different agents
  tools: string[]; // Subset of tools
  memory: boolean; // Whether to use shared memory
  autonomy: AutonomyLevel;
}

type AutonomyLevel = 'supervised' | 'semi-autonomous' | 'fully-autonomous';
```

#### 4.2 Agent Collaboration

**Requirements:**

- [ ] **Task Decomposition** - Break complex tasks into subtasks
- [ ] **Agent Routing** - Route subtasks to appropriate agents
- [ ] **Inter-Agent Communication** - Agents can talk to each other
- [ ] **Result Aggregation** - Combine results from multiple agents
- [ ] **Conflict Resolution** - Handle disagreements between agents

**Example:**
User: "Build a full-stack web app for task management"

1. **Planner Agent** breaks down the task:
   - Design database schema
   - Create backend API
   - Build frontend UI
   - Write documentation
   - Deploy to cloud

2. **Agents work in parallel:**
   - **Data Agent** designs PostgreSQL schema
   - **Coder Agent** builds Node.js backend
   - **Creative Agent** designs UI mockups
   - **Coder Agent** implements React frontend
   - **System Agent** sets up Docker & deployment

3. **Results aggregated** into complete application

#### 4.3 Agent Swarm Orchestration

**Requirements:**

- [ ] **Swarm Controller** - Manage multiple agents
- [ ] **Load Balancing** - Distribute tasks across agents
- [ ] **Consensus Building** - Multiple agents vote on decisions
- [ ] **Specialization Learning** - Agents learn to specialize based on performance

---

### Pillar 5: Advanced Intelligence 🧠

**Objective:** Atlas has human-like reasoning, creativity, and emotional intelligence.

#### 5.1 Reasoning Engine

**Requirements:**

- [ ] **Chain-of-Thought** - Show reasoning process step-by-step
- [ ] **Multi-Step Planning** - Complex multi-step task planning
- [ ] **Hypothesis Testing** - Test multiple approaches, select best
- [ ] **Causal Reasoning** - Understand cause and effect
- [ ] **Counterfactual Thinking** - "What if" scenario analysis

**Example:**
User: "Why is my website slow?"

Atlas reasoning:

1. "Let me check the frontend performance..."
2. "JavaScript bundle is 5MB - that's large"
3. "Checking backend response times..."
4. "Database queries taking 2s each - found the bottleneck"
5. "Recommendations: 1) Implement code splitting, 2) Add DB indexes"

#### 5.2 Creative Capabilities

**Requirements:**

- [ ] **Content Generation** - Write articles, stories, marketing copy
- [ ] **Code Architecture** - Design system architecture, not just implement
- [ ] **UI/UX Design** - Generate design ideas, color schemes, layouts
- [ ] **Problem Solving** - Novel solutions to complex problems
- [ ] **Brainstorming** - Generate and evaluate ideas

#### 5.3 Emotional Intelligence

**Current State:** Basic prosody analysis exists
**Target:** Advanced emotional awareness

**Requirements:**

- [ ] **Mood Detection** - Detect user mood from voice, text, behavior
- [ ] **Empathetic Responses** - Adjust tone based on user emotional state
- [ ] **Stress Detection** - Detect when user is stressed/overwhelmed
- [ ] **Emotional Memory** - Remember emotional context of conversations
- [ ] **Supportive Presence** - Provide encouragement, celebrate wins

**Example:**

- User sounds tired → "You sound exhausted. Want me to handle your emails while you rest?"
- User celebrates success → "That's amazing! I remember how hard you worked on this."
- User is frustrated → "I can hear the frustration. Let's break this down into smaller steps."

---

### Pillar 6: Continuous Learning 📚

**Objective:** Atlas learns continuously from every source available.

#### 6.1 Web Learning

**Requirements:**

- [ ] **Active Web Browsing** - Browse web to learn new information
- [ ] **RSS/News Feeds** - Monitor news sources for relevant updates
- [ ] **Research Papers** - Read and summarize academic papers
- [ ] **Documentation** - Auto-read docs for new technologies
- [ ] **Trend Detection** - Identify emerging trends in user's field

#### 6.2 Document Learning

**Requirements:**

- [ ] **PDF Processing** - Extract and learn from PDF documents
- [ ] **Codebase Learning** - Learn user's codebase structure and patterns
- [ ] **Note Integration** - Connect with Notion, Obsidian, Evernote
- [ ] **Book Summarization** - Read and summarize books
- [ ] **Knowledge Graph** - Build personal knowledge graph for user

#### 6.3 Conversation Learning

**Requirements:**

- [ ] **Preference Extraction** - Learn preferences from conversations
- [ ] **Fact Extraction** - Extract and remember facts about user
- [ ] **Goal Tracking** - Track goals mentioned in conversations
- [ ] **Relationship Mapping** - Remember people and relationships
- [ ] **Context Persistence** - Maintain context across long time periods

---

## v2.0 Implementation Roadmap

### Phase 1: Foundation (Months 1-2)

**Focus:** Build infrastructure for autonomy and self-improvement

**Deliverables:**

1. **Task Scheduler v2** - Advanced background task engine
2. **Context Engine** - Real-time context detection
3. **Performance Monitor** - Self-monitoring and optimization framework
4. **Learning Framework** - Feedback collection and learning pipeline

**Success Metrics:**

- Can run 100+ background tasks simultaneously
- Context detection accuracy >90%
- Performance overhead <5%

### Phase 2: Intelligence (Months 3-4)

**Focus:** Advanced reasoning and multi-agent system

**Deliverables:**

1. **Reasoning Engine** - Chain-of-thought and planning
2. **Multi-Agent Framework** - Agent creation and orchestration
3. **Specialized Agents** - Coder, Research, Creative agents
4. **Emotional Intelligence v2** - Advanced mood detection

**Success Metrics:**

- Complex task planning with >10 steps
- Multi-agent collaboration on real tasks
- Emotional state detection accuracy >85%

### Phase 3: Integration (Months 5-6)

**Focus:** Deep OS and app integration

**Deliverables:**

1. **OS Integration Layer** - Native OS APIs
2. **Hardware Control** - Audio, display, peripherals
3. **Native Extensions** - VS Code, Browser extensions
4. **Global Hotkeys** - System-wide shortcuts

**Success Metrics:**

- Support for Windows, macOS, Linux
- Control 20+ native applications
- System tray/menu bar presence

### Phase 4: Autonomy (Months 7-8)

**Focus:** Full autonomous operation

**Deliverables:**

1. **Autonomous Mode** - Self-directed task execution
2. **Proactive Engine** - Predictive suggestions
3. **Self-Improvement** - Auto-optimization
4. **Tool Generation** - Automatic tool creation

**Success Metrics:**

- 50% of tasks initiated autonomously
- 20% performance improvement through self-optimization
- Generate working tools for novel tasks

### Phase 5: Ecosystem (Months 9-12)

**Focus:** Skills platform and community

**Deliverables:**

1. **Skills Marketplace** - Public skills registry
2. **Community Tools** - User-contributed tools
3. **Mobile Companion** - iOS/Android apps
4. **Cloud Sync** - Cross-device synchronization

**Success Metrics:**

- 100+ community skills
- 10,000+ active users
- Mobile apps with 4+ star rating

---

## Technical Architecture v2.0

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATLAS v2.0 CORE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   VOICE      │  │    VISION    │  │   CONTEXT    │          │
│  │   ENGINE     │  │   ENGINE     │  │   ENGINE     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                    │
│                    ┌──────▼──────┐                             │
│                    │   BRAIN     │                             │
│                    │  (LLM Core) │                             │
│                    └──────┬──────┘                             │
│                           │                                    │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                  │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐          │
│  │  AUTONOMY   │  │  MULTI-     │  │  SELF-      │          │
│  │  ENGINE     │  │  AGENT      │  │  IMPROVE    │          │
│  └─────────────┘  │  SYSTEM     │  │  MENT       │          │
│                   └─────────────┘  └─────────────┘          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                        SERVICES LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  MEMORY  │ │  TOOLS   │ │  SKILLS  │ │  LEARN   │          │
│  │  SYSTEM  │ │  ENGINE  │ │  REGISTRY│ │  ENGINE  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    INTEGRATION LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │    OS    │ │  NATIVE  │ │  CLOUD   │ │  MOBILE  │          │
│  │   APIs   │ │   APPS   │ │   SYNC   │ │  NODES   │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Technologies

| Component   | v1.0                  | v2.0                               |
| ----------- | --------------------- | ---------------------------------- |
| LLM         | Fireworks/OpenRouter  | Multi-model with fine-tuning       |
| Voice       | Deepgram + ElevenLabs | Custom models + voice cloning      |
| Memory      | LanceDB + SQLite      | Vector DB + Graph DB + Time-series |
| Agents      | Single agent          | Multi-agent swarm                  |
| Learning    | None                  | Continuous RLHF                    |
| Integration | Electron              | Electron + Native modules          |
| UI          | React + Three.js      | React + Three.js + Native UI       |

---

## Success Metrics for v2.0

### User Engagement

- **DAU:** 10,000+ (100x increase)
- **Session Duration:** 30+ minutes average
- **Autonomous Tasks:** 50+ per user per day
- **User Retention:** 70%+ at 30 days

### Performance

- **Response Time:** <500ms for simple queries
- **Task Completion:** 95%+ success rate for autonomous tasks
- **Learning Speed:** 10x improvement from v1.0
- **Memory Efficiency:** <1GB for 1M memories

### Intelligence

- **Reasoning Accuracy:** 90%+ on complex tasks
- **Emotional Detection:** 85%+ accuracy
- **Prediction Accuracy:** 70%+ for proactive suggestions
- **Code Generation:** 95%+ compilation success rate

### Business

- **NPS Score:** 70+ (world-class)
- **Paid Conversion:** 20%+ freemium conversion
- **Churn Rate:** <5% monthly
- **Viral Coefficient:** >0.5 (organic growth)

---

## Risk Assessment & Mitigation

### High Risk

| Risk                     | Impact        | Mitigation                                          |
| ------------------------ | ------------- | --------------------------------------------------- |
| Autonomy gone wrong      | User harm     | Strict sandboxing, approval gates, kill switch      |
| Privacy concerns         | User trust    | Local-first, on-device processing, encryption       |
| Performance degradation  | UX issues     | Continuous profiling, resource limits, optimization |
| Security vulnerabilities | Data breaches | Security audits, bug bounty, penetration testing    |

### Medium Risk

| Risk                  | Impact             | Mitigation                                  |
| --------------------- | ------------------ | ------------------------------------------- |
| Multi-agent conflicts | Incorrect results  | Consensus algorithms, voting systems        |
| Over-automation       | User disconnection | Transparency, user control, opt-in features |
| Learning bias         | Unfair outcomes    | Bias detection, diverse training data       |
| Regulatory issues     | Legal problems     | GDPR compliance, data residency options     |

---

## Competitive Advantage

### vs. Claude for Chrome

- **Proactive vs Reactive** - Atlas anticipates, Claude responds
- **Deep Integration** - Atlas controls OS, Claude only browser
- **Multi-Agent** - Atlas swarm collaboration, Claude single agent
- **Self-Improving** - Atlas learns and optimizes, Claude static

### vs. Siri/Alexa/Google

- **Intelligence** - Atlas uses advanced LLMs, competitors use simple NLP
- **Autonomy** - Atlas runs background tasks, competitors only respond
- **Integration** - Atlas deeply integrated, competitors siloed
- **Privacy** - Atlas local-first, competitors cloud-dependent

### vs. GitHub Copilot

- **Scope** - Atlas general purpose, Copilot only coding
- **Context** - Atlas knows your whole system, Copilot only IDE
- **Autonomy** - Atlas can run tests/deploy, Copilot only suggests
- **Voice** - Atlas voice-first, Copilot typing only

---

## Conclusion

Atlas v2.0 transforms from a "smart assistant" into an "autonomous AI companion." The key differentiators are:

1. **Autonomy** - Runs independently, takes initiative
2. **Self-Improvement** - Learns and optimizes continuously
3. **Deep Integration** - Native OS and hardware control
4. **Multi-Agent** - Swarm intelligence for complex tasks
5. **Emotional Intelligence** - Truly understands and empathizes

With the solid v1.0 foundation now complete (voice pipeline, multi-channel gateway, web search, browser automation, 60+ tools), v2.0 builds the intelligence layer that makes Atlas truly amazing.

**Powered by Kimi K2.5** - The AI brain that makes Atlas not just functional, but truly intelligent. 🚀

---

_"The best AI is the one that knows what you need before you do."_ - Atlas v2.0 Vision

**Next Steps:**

1. Begin Phase 1 implementation (Task Scheduler v2)
2. Set up performance monitoring infrastructure
3. Design multi-agent communication protocol
4. Start emotional intelligence model training
5. Build OS integration layer for all platforms

_This document is a living roadmap. Update quarterly based on progress and user feedback._
