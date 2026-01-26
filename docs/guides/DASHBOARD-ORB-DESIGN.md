# Atlas Dashboard + Orb Integration Design

## Overview

The Atlas dashboard combines an AGNT-style metrics/workflow interface with a voice-first orb as the primary interaction point. The orb is NOT a secondary element - it IS Atlas.

---

## Visual Layout

```
+-----------------------------------------------------------------------------------+
|  METRICS BAR                                                                       |
|  [Credits: 50,000] [Agents: 12] [Workflows: 8] [Tools: 68] [Runs: 153] [Int: 51]  |
+-----------------------------------------------------------------------------------+
|           |                                        |                              |
|  GOALS    |              ORB ZONE                  |    ACTIVE WORKFLOWS          |
|  MAP      |                                        |                              |
|           |         +------------------+           |    [*] Bitcoin Alert         |
|  Research |         |                  |           |    [*] Email Manager         |
|  [====  ] |         |                  |           |    [*] Daily Backup          |
|           |         |    ATLAS ORB     |           |    [*] Discord Bot           |
|  Learning |         |                  |           |    [ ] Content Schedule      |
|  [==    ] |         |    (3D Sphere)   |           |                              |
|           |         |                  |           |                              |
|  Tasks    |         |                  |           |    INTEGRATIONS              |
|  [=====  ]|         +------------------+           |    [G][O][S][D][T][B]...     |
|           |                                        |    49/50 Healthy             |
|           |         "Listening..."                 |                              |
+-----------+----------------------------------------+------------------------------+
|                                                                                   |
|  AGENTS SWARM                                     |    RUNS QUEUE                |
|  +--------+ +--------+ +--------+ +--------+      |    Queued: 3  Running: 2     |
|  | Trading| | Email  | | Content| | Research|     |    Completed: 167  Failed: 1 |
|  | Bot    | | Manager| | Gen    | | Agent  |      |    p95: 21s                  |
|  +--------+ +--------+ +--------+ +--------+      |                              |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Orb Zone Behavior

The center "Orb Zone" is the heart of the interface. The orb responds to:

### Visual States

```
+-------------------+-------------------+-------------------+-------------------+
|      IDLE         |    LISTENING      |    THINKING       |    SPEAKING       |
+-------------------+-------------------+-------------------+-------------------+
|                   |                   |                   |                   |
|    Slow pulse     |   Expand/glow     |   Rapid swirl     |   Wave pattern    |
|    Subtle drift   |   Particles rise  |   Color shift     |   Audio-reactive  |
|    Ambient colors |   Cyan highlight  |   Purple/orange   |   Green/teal      |
|                   |                   |                   |                   |
|   "Hey Atlas"     |   (microphone     |   (processing     |   (TTS playing)   |
|   appears below   |    active)        |    query)         |                   |
+-------------------+-------------------+-------------------+-------------------+
```

### Orb Zone Layout Detail

```
+--------------------------------------------------+
|                                                  |
|              TRANSCRIPT (faded)                  |
|         "What's my portfolio balance?"           |
|                                                  |
|                                                  |
|              +----------------+                  |
|             /                  \                 |
|            |                    |                |
|            |    ATLAS ORB       |                |
|            |    (3D Particles)  |                |
|            |                    |                |
|             \                  /                 |
|              +----------------+                  |
|                                                  |
|              STATUS INDICATOR                    |
|              "Listening..."                      |
|                                                  |
|              TASK PROGRESS (if active)           |
|              [=========>        ] 67%            |
|              "Fetching portfolio data..."        |
|                                                  |
+--------------------------------------------------+
```

---

## Component Hierarchy

```
App.tsx
├── DashboardLayout.tsx
│   ├── MetricsBar.tsx
│   │   ├── MetricCard (Credits)
│   │   ├── MetricCard (Agents)
│   │   ├── MetricCard (Workflows)
│   │   ├── MetricCard (Tools)
│   │   ├── MetricCard (Runs)
│   │   └── MetricCard (Integrations)
│   │
│   ├── LeftSidebar.tsx
│   │   └── GoalsMap.tsx
│   │       └── GoalCard.tsx (multiple)
│   │
│   ├── OrbZone.tsx                    <-- CENTER FOCUS
│   │   ├── TranscriptOverlay.tsx      (faded recent transcript)
│   │   ├── AtlasOrb.tsx               (existing 3D orb)
│   │   │   └── AtlasParticles.tsx
│   │   ├── StatusIndicator.tsx        (Listening/Thinking/Speaking)
│   │   └── TaskProgress.tsx           (current task progress bar)
│   │
│   ├── RightSidebar.tsx
│   │   ├── ActiveWorkflows.tsx
│   │   │   └── WorkflowCard.tsx (multiple)
│   │   └── IntegrationsGrid.tsx
│   │       └── IntegrationIcon.tsx (multiple)
│   │
│   └── BottomPanel.tsx
│       ├── AgentsSwarm.tsx
│       │   └── AgentCard.tsx (multiple)
│       └── RunsQueue.tsx
│           └── RunStats.tsx
│
└── WorkflowBuilder.tsx (separate view)
    ├── WorkflowCanvas.tsx (ReactFlow)
    ├── NodePalette.tsx
    └── WorkflowAssistant.tsx
```

---

## Orb Interaction Flow

```
                                    USER SPEAKS
                                         |
                                         v
+--------------------------------------------------------------------------------+
|                                                                                |
|  1. WAKE WORD DETECTED                                                         |
|     - Orb transitions: IDLE -> LISTENING                                       |
|     - Particles expand outward                                                 |
|     - Cyan glow intensifies                                                    |
|     - Status shows "Listening..."                                              |
|                                                                                |
+--------------------------------------------------------------------------------+
                                         |
                                         v
+--------------------------------------------------------------------------------+
|                                                                                |
|  2. SPEECH CAPTURED (VAD detects end of speech)                                |
|     - Orb transitions: LISTENING -> THINKING                                   |
|     - Particles swirl inward rapidly                                           |
|     - Color shifts to purple/orange                                            |
|     - Status shows "Thinking..."                                               |
|     - Transcript appears above orb (faded)                                     |
|                                                                                |
+--------------------------------------------------------------------------------+
                                         |
                                         v
+--------------------------------------------------------------------------------+
|                                                                                |
|  3. LLM PROCESSING                                                             |
|     - If task detected: TaskProgress bar appears                               |
|     - Steps shown: "Step 1/3: Fetching data..."                                |
|     - Tools executed in sequence                                               |
|                                                                                |
+--------------------------------------------------------------------------------+
                                         |
                                         v
+--------------------------------------------------------------------------------+
|                                                                                |
|  4. RESPONSE READY                                                             |
|     - Orb transitions: THINKING -> SPEAKING                                    |
|     - Particles form wave patterns (audio-reactive)                            |
|     - Color shifts to green/teal                                               |
|     - Status shows response text (scrolling if long)                           |
|     - TTS plays through speakers                                               |
|                                                                                |
+--------------------------------------------------------------------------------+
                                         |
                                         v
+--------------------------------------------------------------------------------+
|                                                                                |
|  5. RESPONSE COMPLETE                                                          |
|     - Orb transitions: SPEAKING -> IDLE                                        |
|     - Particles settle back to slow drift                                      |
|     - Ambient colors return                                                    |
|     - Status shows "Hey Atlas" prompt                                          |
|                                                                                |
+--------------------------------------------------------------------------------+
```

---

## Barge-In Behavior

```
+--------------------------------------------------------------------------------+
|  USER INTERRUPTS WHILE ATLAS IS SPEAKING                                       |
+--------------------------------------------------------------------------------+
|                                                                                |
|  1. Wake word detected OR voice activity during SPEAKING state                 |
|                                                                                |
|  2. IMMEDIATE ACTIONS:                                                         |
|     - TTS audio STOPS instantly                                                |
|     - LLM generation CANCELLED                                                 |
|     - Orb transitions: SPEAKING -> LISTENING                                   |
|     - Visual "interrupt" flash (brief white pulse)                             |
|                                                                                |
|  3. NEW LISTENING CYCLE:                                                       |
|     - Previous context maintained                                              |
|     - New utterance captured                                                   |
|     - Continues normal flow                                                    |
|                                                                                |
+--------------------------------------------------------------------------------+
```

---

## Dashboard Panels Detail

### Metrics Bar

```
+-----------------------------------------------------------------------------------+
|  [icon] 50,000   [icon] 12      [icon] 8       [icon] 68    [icon] 153   [icon] 51|
|  Credits         Agents         Workflows      Tools        Runs/24h     Integs   |
+-----------------------------------------------------------------------------------+

Each metric:
- Clickable (expands to detail view)
- Real-time updates via IPC
- Color-coded (green=good, yellow=warning, red=error)
```

### Goals Map

```
+-------------------+
|  GOALS MAP        |
+-------------------+
|                   |
|  Research         |
|  [========>   ] 80%
|  PhD AI Papers    |
|                   |
|  Learning         |
|  [====>      ] 40%
|  React Advanced   |
|                   |
|  Tasks            |
|  [==========] 100%
|  Weekly Review    |
|                   |
|  Trading          |
|  [======>    ] 60%
|  Backtest LSTM    |
|                   |
+-------------------+

Features:
- Voice: "Add goal: Learn Rust"
- Progress auto-updates from task completion
- Linked to Obsidian vault goals
```

### Active Workflows

```
+----------------------+
|  ACTIVE WORKFLOWS    |
+----------------------+
|                      |
|  [*] Bitcoin Alert   |
|      LISTENING       |
|      Last: 2m ago    |
|                      |
|  [*] Email Manager   |
|      LISTENING       |
|      Last: 5m ago    |
|                      |
|  [>] Content Gen     |
|      RUNNING         |
|      Step 2/4        |
|                      |
|  [ ] Daily Backup    |
|      SCHEDULED       |
|      Next: 2:00 AM   |
|                      |
+----------------------+

Status icons:
[*] = Listening (active trigger)
[>] = Running (executing now)
[ ] = Scheduled (waiting)
[!] = Error (needs attention)
```

### Agents Swarm

```
+--------+ +--------+ +--------+ +--------+ +--------+
| TRADE  | | EMAIL  | | CONTENT| | RESEARCH| | DISCORD|
|  BOT   | | MGR    | |  GEN   | |  AGENT | |  BOT   |
|        | |        | |        | |        | |        |
| Active | | Idle   | | Running| | Idle   | | Active |
| 3 tasks| | 0 tasks| | 1 task | | 0 tasks| | 2 tasks|
+--------+ +--------+ +--------+ +--------+ +--------+

Each agent card:
- Name and icon
- Status (Active/Idle/Running/Error)
- Current task count
- Click to view details
- Voice: "Show me what Trading Bot is doing"
```

### Integrations Grid

```
+---------------------------+
|  INTEGRATIONS  49/50 OK   |
+---------------------------+
|  [G] [O] [S] [D] [T] [B]  |
|  [Bi][Co][Sc][MT][Tw][YT] |
|  [Tk][Sp][VS][Di][Ex][Gh] |
+---------------------------+

Icons for:
G = Gmail           O = Outlook       S = Spotify
D = Discord         T = Twilio        B = Brave
Bi = Binance        Co = Coinbase     Sc = Schwab
MT = MetaTrader     Tw = Twitter      YT = YouTube
Tk = TikTok         Sp = Spotify      VS = VS Code
Di = Discord        Ex = Explorer     Gh = GitHub

Color coding:
- Green border = Connected & healthy
- Yellow border = Connected with warnings
- Red border = Disconnected or error
- Gray = Not configured
```

---

## Responsive Behavior

### Full Desktop (1920x1080+)

```
+-------+------------------+-------+
| Goals |       ORB        | Work  |
| Map   |                  | flows |
+-------+------------------+-------+
|        Agents Swarm      | Runs  |
+--------------------------+-------+
```

### Compact (1280x720)

```
+------------------+-------+
|       ORB        | Side  |
|                  | bar   |
+------------------+-------+
|    Bottom Panel          |
+--------------------------+
```

### Orb-Only Mode (Hotkey: F11)

```
+---------------------------+
|                           |
|                           |
|        ATLAS ORB          |
|        (Fullscreen)       |
|                           |
|                           |
|       "Listening..."      |
+---------------------------+
```

---

## Color Scheme

```
Background:       #0a0a0f (near black)
Panel Background: #12121a (dark navy)
Panel Border:     #1e1e2e (subtle)
Primary Accent:   #00d4aa (cyan/teal)
Secondary Accent: #8b5cf6 (purple)
Warning:          #f59e0b (amber)
Error:            #ef4444 (red)
Success:          #10b981 (green)
Text Primary:     #ffffff
Text Secondary:   #94a3b8 (muted)

Orb States:
- Idle:      #4a5568 -> #718096 (gray gradient)
- Listening: #00d4aa -> #06b6d4 (cyan gradient)
- Thinking:  #8b5cf6 -> #f59e0b (purple to amber)
- Speaking:  #10b981 -> #00d4aa (green to cyan)
```

---

## Implementation Priority

### Phase 1: Core Layout (UI-001 to UI-005)

1. DashboardLayout grid structure
2. MetricsBar with mock data
3. OrbZone wrapper (integrate existing AtlasOrb)
4. Basic sidebars (placeholders)

### Phase 2: Goals & Workflows (UI-006 to UI-017)

1. GoalsMap with Obsidian integration
2. ActiveWorkflows sidebar
3. Real-time status updates

### Phase 3: Agents & Integrations (UI-010 to UI-020)

1. AgentsSwarm visualization
2. IntegrationsGrid with health status
3. RunsQueue statistics

### Phase 4: Workflow Builder (UI-021 to UI-024)

1. ReactFlow canvas setup
2. Node types and palette
3. Workflow execution integration

---

## Tech Stack for Dashboard

| Component        | Technology               | Why                                |
| ---------------- | ------------------------ | ---------------------------------- |
| Layout           | CSS Grid + Flexbox       | Native, performant                 |
| State            | Zustand (dashboardStore) | Already using for Atlas state      |
| Charts           | Recharts                 | Lightweight, React-native          |
| Animations       | Framer Motion            | Smooth transitions                 |
| Workflow Builder | ReactFlow                | Industry standard for node editors |
| Icons            | Lucide React             | Consistent, lightweight            |

---

## File Structure

```
src/renderer/
├── components/
│   ├── dashboard/
│   │   ├── DashboardLayout.tsx
│   │   ├── MetricsBar.tsx
│   │   ├── MetricCard.tsx
│   │   ├── OrbZone.tsx
│   │   ├── LeftSidebar.tsx
│   │   ├── RightSidebar.tsx
│   │   ├── BottomPanel.tsx
│   │   ├── GoalsMap.tsx
│   │   ├── GoalCard.tsx
│   │   ├── ActiveWorkflows.tsx
│   │   ├── WorkflowCard.tsx
│   │   ├── AgentsSwarm.tsx
│   │   ├── AgentCard.tsx
│   │   ├── IntegrationsGrid.tsx
│   │   ├── IntegrationIcon.tsx
│   │   ├── RunsQueue.tsx
│   │   └── index.ts
│   │
│   ├── workflow-builder/
│   │   ├── WorkflowBuilder.tsx
│   │   ├── WorkflowCanvas.tsx
│   │   ├── NodePalette.tsx
│   │   ├── nodes/
│   │   │   ├── TriggerNode.tsx
│   │   │   ├── ActionNode.tsx
│   │   │   ├── LogicNode.tsx
│   │   │   └── IntegrationNode.tsx
│   │   └── index.ts
│   │
│   └── orb/                    # Existing
│       ├── AtlasOrb.tsx
│       ├── AtlasParticles.tsx
│       └── ...
│
├── stores/
│   ├── dashboardStore.ts       # NEW
│   └── atlasStore.ts           # Existing
│
├── hooks/
│   ├── useDashboard.ts         # NEW
│   └── useAtlasState.ts        # Existing
│
└── styles/
    └── dashboard.css           # NEW
```

---

Last Updated: 2026-01-16
