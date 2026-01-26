# Atlas Desktop - Palantir-Style UI Design System

**Version:** 1.0  
**Date:** January 22, 2026  
**Inspiration:** Palantir Foundry/Gotham, Bloomberg Terminal, Mission Control

---

## 1. Design Philosophy

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Data Density** | Maximum information per pixel - no wasted space |
| **Object-Centric** | Everything is an entity with relationships |
| **Dark by Default** | Reduce eye strain, emphasize data with light |
| **Contextual Depth** | Drill down from overview → detail → action |
| **Real-Time First** | Live data, streaming updates, no stale views |
| **Keyboard-Native** | Power users never touch the mouse |

### Visual Identity

```
Background:     #0A0E14 (near-black with blue undertone)
Surface:        #131820 (card backgrounds)
Border:         #1E2530 (subtle separation)
Text Primary:   #E8EAED (off-white, easy on eyes)
Text Secondary: #8B95A5 (muted for labels)
Accent Cyan:    #00D4FF (primary actions, links)
Accent Green:   #00FF88 (success, positive values)
Accent Red:     #FF4757 (errors, negative values, alerts)
Accent Yellow:  #FFD93D (warnings, pending states)
Accent Purple:  #9B59B6 (AI/intelligence indicators)
```

---

## 2. Layout Architecture

### Primary Layout: Command Center

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [≡] ATLAS                    SEARCH (⌘K)                    [🔔] [⚙] [👤]  │ ← Header Bar (40px)
├────────┬────────────────────────────────────────────────────┬───────────────┤
│        │                                                    │               │
│ NAV    │                  MAIN CANVAS                       │   CONTEXT     │
│        │                                                    │   PANEL       │
│ • Dash │    ┌─────────────────────────────────────────┐    │               │
│ • Trade│    │                                         │    │  Entity       │
│ • Bank │    │          ACTIVE WORKSPACE               │    │  Details      │
│ • Intel│    │                                         │    │               │
│ • Voice│    │   (Widgets / Charts / Tables / Orb)     │    │  Actions      │
│ • Tools│    │                                         │    │               │
│        │    │                                         │    │  Related      │
│ ─────  │    └─────────────────────────────────────────┘    │               │
│ AGENTS │                                                    │  History      │
│ • Trade│    ┌─────────┐ ┌─────────┐ ┌─────────┐           │               │
│ • Res. │    │ Widget  │ │ Widget  │ │ Widget  │           │               │
│ • Proj │    └─────────┘ └─────────┘ └─────────┘           │               │
│        │                                                    │               │
├────────┴────────────────────────────────────────────────────┴───────────────┤
│ STATUS: ● Voice Ready  │ Trading: +£340  │ 3 Alerts  │ CPU 23%  │ 14:32:05 │ ← Status Bar (28px)
└─────────────────────────────────────────────────────────────────────────────┘

Left Nav:     48px collapsed, 200px expanded
Context Panel: 320px (collapsible)
Status Bar:   28px fixed
Header:       40px fixed
```

### Secondary Layout: Focus Mode (Voice/Orb)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                                                                             │
│                              ┌───────────┐                                  │
│                              │           │                                  │
│                              │    ORB    │                                  │
│                              │           │                                  │
│                              └───────────┘                                  │
│                                                                             │
│                         "How can I help you?"                               │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ User: Check my portfolio and summarize today's trades              │  │
│   │ Atlas: Looking at your positions now...                            │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                    [🎤 Listening]  [⌨ Type]  [📎 Attach]                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Specifications

### 3.1 Header Bar

```
Height: 40px
Background: #0D1117
Border-bottom: 1px solid #1E2530

Components:
├── Logo + App Name (left)
│   Font: 14px, 600 weight, #E8EAED
│   Icon: 20px Atlas logo
│
├── Global Search (center)
│   Width: 400px max
│   Background: #131820
│   Border: 1px solid #1E2530
│   Placeholder: "Search or type command... (⌘K)"
│   Icon: Search icon left, shortcut hint right
│
└── Actions (right)
    ├── Notifications bell with count badge
    ├── Settings gear
    └── User avatar/initials
```

### 3.2 Left Navigation

```
Width: 48px collapsed, 200px expanded
Background: #0D1117
Border-right: 1px solid #1E2530

Item Structure:
├── Icon (24px)
├── Label (when expanded)
└── Active indicator (3px left border, cyan)

Sections:
├── MAIN
│   ├── Dashboard (grid icon)
│   ├── Trading (chart icon)
│   ├── Banking (wallet icon)
│   ├── Intelligence (brain icon)
│   └── Voice (mic icon)
│
├── TOOLS
│   ├── Browser Agent (globe icon)
│   ├── Code (terminal icon)
│   ├── Files (folder icon)
│   └── Calendar (calendar icon)
│
└── AGENTS (collapsible)
    ├── Trading Agent (● green when active)
    ├── Research Agent
    ├── Project Agent
    ├── Financial Agent
    └── Relationship Agent
```

### 3.3 Widget Cards

```
Background: #131820
Border: 1px solid #1E2530
Border-radius: 8px
Padding: 16px

Header:
├── Title (14px, 500 weight, #E8EAED)
├── Subtitle/timestamp (12px, #8B95A5)
└── Actions (icon buttons, 20px)

States:
├── Default: border #1E2530
├── Hover: border #2A3441
├── Selected: border #00D4FF
└── Loading: skeleton pulse animation
```

### 3.4 Data Tables

```
Background: #131820
Border: 1px solid #1E2530

Header Row:
├── Background: #0D1117
├── Font: 11px, 600 weight, #8B95A5, uppercase
├── Padding: 8px 12px
└── Sortable: icon on hover

Data Rows:
├── Font: 13px, 400 weight, #E8EAED
├── Padding: 10px 12px
├── Border-bottom: 1px solid #1E2530
├── Hover: background #1A2332
└── Selected: background #1E3A5F

Numeric Values:
├── Positive: #00FF88
├── Negative: #FF4757
└── Neutral: #E8EAED

Row Actions:
└── Icon buttons appear on hover (right side)
```

### 3.5 Charts

```
Background: transparent or #131820
Grid lines: #1E2530 (subtle)
Axis labels: 11px, #8B95A5

Colors (in order):
1. #00D4FF (cyan)
2. #00FF88 (green)
3. #FFD93D (yellow)
4. #FF4757 (red)
5. #9B59B6 (purple)
6. #3498DB (blue)

Tooltips:
├── Background: #1A2332
├── Border: 1px solid #2A3441
├── Shadow: 0 4px 12px rgba(0,0,0,0.3)
└── Font: 12px
```

### 3.6 Entity Cards (Object View)

```
Width: 100% of container
Background: #131820
Border: 1px solid #1E2530
Border-radius: 8px

Layout:
┌──────────────────────────────────────────────┐
│ [Icon] Entity Name                    [···]  │ Header
├──────────────────────────────────────────────┤
│ Type: Person                                 │
│ Confidence: 0.95 ████████████░░              │
│                                              │
│ Properties                                   │
│ ├── Email: john@example.com                  │
│ ├── Company: Acme Corp                       │
│ └── Last Contact: 2 days ago                 │
│                                              │
│ Relationships (5)                            │
│ ├── → Works at: Acme Corp                    │
│ ├── → Knows: Jane Smith                      │
│ └── [Show more...]                           │
├──────────────────────────────────────────────┤
│ [View] [Edit] [Add Relationship]             │ Actions
└──────────────────────────────────────────────┘
```

### 3.7 Status Bar

```
Height: 28px
Background: #0A0E14
Border-top: 1px solid #1E2530
Font: 12px, #8B95A5

Sections (flex, space-between):
├── Left: Connection status, voice state
├── Center: Active agent, current task
└── Right: System stats, time

Status Indicators:
├── ● Green: Active/Connected/Success
├── ● Yellow: Warning/Pending
├── ● Red: Error/Disconnected
└── ○ Gray: Inactive/Disabled
```

### 3.8 Context Panel (Right Sidebar)

```
Width: 320px (collapsible to 0)
Background: #0D1117
Border-left: 1px solid #1E2530

Sections:
├── Entity Header
│   ├── Icon + Name
│   ├── Type badge
│   └── Close button
│
├── Quick Actions
│   └── Button row (primary actions)
│
├── Properties (collapsible)
│   └── Key-value pairs
│
├── Relationships (collapsible)
│   └── List of related entities
│
├── Timeline (collapsible)
│   └── Recent events/changes
│
└── Notes/Comments (collapsible)
```

---

## 4. View Specifications

### 4.1 Dashboard View

```
Grid: 12-column responsive
Gap: 16px
Padding: 20px

Default Widgets:
├── Row 1 (full width)
│   └── Metrics Bar: 4 key stats (P&L, Balance, Tasks, Alerts)
│
├── Row 2 (8 + 4 columns)
│   ├── Main Chart: Portfolio/Activity over time
│   └── Agent Status: List of active agents
│
├── Row 3 (4 + 4 + 4 columns)
│   ├── Recent Trades
│   ├── Upcoming Tasks
│   └── Notifications
│
└── Row 4 (6 + 6 columns)
    ├── Knowledge Graph Mini (top connections)
    └── Voice Activity (recent commands)
```

### 4.2 Trading View

```
Layout:
┌─────────────────────────────────────────────────────────────────┐
│  TRADING                              [+ New Order] [Settings]   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │ Portfolio   │ │ Day P&L     │ │ Open Pos    │ │ Win Rate   │ │
│  │ £24,350     │ │ +£340.50    │ │ 3           │ │ 68%        │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                                              │                   │
│  POSITIONS                                   │  ORDER BOOK       │
│  ┌────────────────────────────────────────┐  │  ┌─────────────┐ │
│  │ Symbol │ Size  │ Entry │ P&L  │ Action │  │  │ Bid │ Ask   │ │
│  │ ETH    │ 0.5   │ 2,400 │ +£85 │ [X]    │  │  │ ... │ ...   │ │
│  │ SOL    │ 10    │ 98.50 │ +£42 │ [X]    │  │  └─────────────┘ │
│  │ BTC    │ -0.1  │ 42000 │ -£23 │ [X]    │  │                   │
│  └────────────────────────────────────────┘  │  SIGNALS          │
│                                              │  ┌─────────────┐ │
│  TRADE HISTORY (Today)                       │  │ ● Momentum  │ │
│  ┌────────────────────────────────────────┐  │  │ ● Breakout  │ │
│  │ Time  │ Symbol │ Side │ Size │ P&L    │  │  └─────────────┘ │
│  │ 14:20 │ ETH    │ BUY  │ 0.5  │ +£85   │  │                   │
│  └────────────────────────────────────────┘  │                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Intelligence View (Knowledge Graph)

```
Layout:
┌─────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE                    [+ Entity] [Import] [Export]    │
├─────────────────────────────────────────────────────────────────┤
│  Search: [________________________________] [Filters ▼]         │
├────────────────────────────────────────────┬────────────────────┤
│                                            │                    │
│     ┌───────────────────────────────┐     │  SELECTED ENTITY   │
│     │                               │     │                    │
│     │     KNOWLEDGE GRAPH           │     │  Name: John Smith  │
│     │     (Force-directed viz)      │     │  Type: Person      │
│     │                               │     │                    │
│     │   [Entity nodes connected     │     │  Properties:       │
│     │    with labeled edges]        │     │  • Email: ...      │
│     │                               │     │  • Company: ...    │
│     │                               │     │                    │
│     └───────────────────────────────┘     │  Relationships:    │
│                                            │  • Works at →      │
│  Legend: ● Person ● Company ● Project      │  • Knows →         │
│                                            │                    │
├────────────────────────────────────────────┴────────────────────┤
│  RECENT ENTITIES                                                │
│  [Card] [Card] [Card] [Card] [Card]                             │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Banking View

```
Layout:
┌─────────────────────────────────────────────────────────────────┐
│  BANKING                              [+ Payment] [Sync]        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │ Total Bal   │ │ This Month  │ │ Committed   │ │ Available  │ │
│  │ £12,450     │ │ -£2,340     │ │ £1,200      │ │ £8,910     │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ACCOUNTS                        │  SPENDING BY CATEGORY        │
│  ┌────────────────────────────┐  │  ┌──────────────────────────┐│
│  │ [Monzo] Current            │  │  │    [Donut Chart]         ││
│  │ £8,234.50                  │  │  │                          ││
│  │ ↓ +£340 today              │  │  │  Food: 35%               ││
│  ├────────────────────────────┤  │  │  Transport: 20%          ││
│  │ [HSBC] Savings             │  │  │  Bills: 25%              ││
│  │ £4,215.00                  │  │  │  Other: 20%              ││
│  └────────────────────────────┘  │  └──────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  RECENT TRANSACTIONS                          [Filter ▼] [Export]│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Today                                                        ││
│  │ ├── Tesco          Food & Groceries           -£45.20       ││
│  │ ├── TfL            Transport                  -£8.50        ││
│  │ └── Salary         Income                     +£3,200.00    ││
│  │ Yesterday                                                    ││
│  │ └── Netflix        Entertainment              -£15.99       ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Interaction Patterns

### 5.1 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Command Palette |
| `⌘/` | Global Search |
| `⌘1-5` | Switch main views |
| `⌘B` | Toggle left sidebar |
| `⌘I` | Toggle context panel |
| `Esc` | Close modal/panel, deselect |
| `Space` | Activate voice (when idle) |
| `Enter` | Confirm action |
| `Tab` | Navigate focusable elements |
| `⌘.` | Quick actions for selected item |

### 5.2 Voice Integration Points

```
Voice State Indicators:
├── Idle: Subtle pulse on orb (header corner)
├── Listening: Orb expands, cyan glow
├── Processing: Rotating animation
├── Speaking: Audio wave visualization
└── Error: Red flash, shake

Voice Feedback Overlay:
┌─────────────────────────────────────────┐
│ 🎤 "Show me my portfolio"               │
│ ─────────────────────────────────────── │
│ Atlas: Opening trading view...          │
└─────────────────────────────────────────┘
(Appears bottom-center, auto-dismisses after 3s)
```

### 5.3 Notifications

```
Toast Position: Bottom-right
Max visible: 3 stacked

Types:
├── Info: Blue left border
├── Success: Green left border + checkmark
├── Warning: Yellow left border + warning icon
├── Error: Red left border + X icon
└── AI Insight: Purple left border + brain icon

Structure:
┌──────────────────────────────────────┐
│ [Icon] Title                    [X]  │
│ Description text here                │
│ [Action Button]        2 minutes ago │
└──────────────────────────────────────┘
```

---

## 6. Animation Guidelines

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Page transition | Fade + slight scale | 200ms | ease-out |
| Modal open | Fade + scale from 0.95 | 150ms | ease-out |
| Modal close | Fade + scale to 0.95 | 100ms | ease-in |
| Sidebar expand | Width transition | 200ms | ease-out |
| Hover states | All properties | 150ms | ease |
| Loading skeleton | Pulse opacity | 1.5s | ease-in-out |
| Toast enter | Slide up + fade | 200ms | ease-out |
| Toast exit | Slide right + fade | 150ms | ease-in |
| Data update | Flash highlight | 500ms | ease |

---

## 7. Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| Desktop XL | >1600px | Full layout, expanded panels |
| Desktop | 1200-1600px | Standard layout |
| Tablet | 900-1200px | Collapsed left nav, no context panel |
| Mobile | <900px | Bottom nav, stacked layout (not primary target) |

---

## 8. Implementation Priority

### Phase 1: Foundation (Week 1)
- [ ] CSS variables and theme system
- [ ] Header bar component
- [ ] Left navigation component
- [ ] Status bar component
- [ ] Basic layout container

### Phase 2: Core Views (Week 2)
- [ ] Dashboard view with metric widgets
- [ ] Widget card component
- [ ] Data table component
- [ ] Context panel component

### Phase 3: Feature Views (Week 3)
- [ ] Trading view
- [ ] Banking view
- [ ] Intelligence/Graph view

### Phase 4: Polish (Week 4)
- [ ] Animations and transitions
- [ ] Keyboard navigation
- [ ] Voice integration overlays
- [ ] Dark/light mode toggle (dark default)

---

## 9. File Structure

```
src/renderer/
├── styles/
│   ├── variables.css       # CSS custom properties
│   ├── reset.css           # Base reset
│   ├── typography.css      # Font styles
│   ├── animations.css      # Keyframes
│   └── utilities.css       # Utility classes
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx    # Main layout container
│   │   ├── Header.tsx      # Top header bar
│   │   ├── LeftNav.tsx     # Navigation sidebar
│   │   ├── ContextPanel.tsx # Right detail panel
│   │   └── StatusBar.tsx   # Bottom status bar
│   │
│   ├── widgets/
│   │   ├── MetricCard.tsx  # Single metric display
│   │   ├── WidgetCard.tsx  # Generic widget container
│   │   ├── DataTable.tsx   # Sortable data table
│   │   ├── Chart.tsx       # Chart wrapper
│   │   └── EntityCard.tsx  # Object detail card
│   │
│   └── views/
│       ├── DashboardView.tsx
│       ├── TradingView.tsx
│       ├── BankingView.tsx
│       ├── IntelligenceView.tsx
│       └── VoiceView.tsx
```

---

This design system provides the foundation for a Palantir-style interface while maintaining Atlas's unique voice-first identity. The orb remains central but is integrated into a data-dense, keyboard-navigable command center.
