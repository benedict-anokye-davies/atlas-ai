# Atlas Spark UI - Design Specification

**Based on:** Spark AI Interface Design  
**Style:** Futuristic, Cyberpunk, Glassmorphism  
**Date:** January 30, 2026

---

## Color Palette

### Primary Colors

- **Background:** `#0a0a0f` (Deep black)
- **Background Secondary:** `#111118` (Dark navy)
- **Accent Primary:** `#4ade80` (Mint green)
- **Accent Secondary:** `#22d3ee` (Cyan)
- **Accent Tertiary:** `#a78bfa` (Purple)

### Text Colors

- **Primary Text:** `#ffffff` (White)
- **Secondary Text:** `#94a3b8` (Slate gray)
- **Muted Text:** `#64748b` (Dark slate)

### Glassmorphism

- **Panel Background:** `rgba(17, 17, 24, 0.7)`
- **Panel Border:** `rgba(74, 222, 128, 0.2)`
- **Panel Border Hover:** `rgba(74, 222, 128, 0.4)`
- **Blur Amount:** `20px`

---

## Typography

- **Font Family:** Inter, system-ui, sans-serif
- **Headings:** 600 weight
- **Body:** 400 weight
- **Stats:** 700 weight for numbers

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  LEFT SIDEBAR (280px)    │  CENTER (flex)   │  RIGHT (320px)│
│                          │                  │               │
│  ┌─ Stats Card ─┐       │   ┌─ Avatar ─┐   │  ┌─ Stats ─┐  │
│  │ Memories     │       │   │   3D     │   │  │ Wisdom  │  │
│  │ Queue        │       │   │  Head    │   │  │ Context │  │
│  └──────────────┘       │   └──────────┘   │  └─────────┘  │
│                          │                  │               │
│  ┌─ Cognitive ─┐        │   ┌─ Chat ─────┐ │  ┌─ Spark ─┐  │
│  │ Patterns    │        │   │ Messages   │ │  │ Knows   │  │
│  │ Reliability │        │   │ Input      │ │  └─────────┘  │
│  └──────────────┘       │   └────────────┘ │               │
│                          │                  │  ┌─ Taste ─┐  │
│  ┌─ Insights ──┐        │                  │  │ Bank    │  │
│  │ Cards       │        │                  │  └─────────┘  │
│  └──────────────┘       │                  │               │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. GlassPanel

```tsx
<GlassPanel>Content with glassmorphism effect</GlassPanel>
```

### 2. StatCard

```tsx
<StatCard label="Memories" value={32168} trend="up" percentage={86} />
```

### 3. SparkAvatar

```tsx
<SparkAvatar mood="neutral" speaking={false} particles={true} />
```

### 4. ChatBubble

```tsx
<ChatBubble
  type="ai"
  content="I'm neither a local model nor Claude..."
  actions={['I love the answer']}
/>
```

### 5. MetricBadge

```tsx
<MetricBadge label="wisdom" value={14} color="green" />
```

---

## Animations

### Particle System

- Floating particles in background
- Color: teal/green with low opacity
- Movement: Slow drift upward
- Count: 50-100 particles

### Avatar Animations

- Subtle breathing/pulse effect
- Glow intensity changes on speech
- Eye tracking (follows mouse)
- Particle emission when speaking

### UI Animations

- Panel hover: Border glow
- Stats: Count-up animation on load
- Chat: Slide-in from bottom
- Buttons: Scale on hover

---

## Responsive Breakpoints

- **Desktop:** Full 3-column layout
- **Tablet:** Hide right sidebar, show as overlay
- **Mobile:** Single column, sidebars as drawers

---

## Implementation Notes

1. Use CSS Grid for main layout
2. Three.js for 3D avatar (replace current orb)
3. CSS backdrop-filter for glassmorphism
4. Canvas for particle effects
5. Framer Motion for animations
