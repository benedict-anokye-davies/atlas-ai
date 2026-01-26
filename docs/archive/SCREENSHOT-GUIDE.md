# Screenshot & Demo Guide

This guide documents the key screenshots and demo recordings needed for marketing Atlas Desktop.

---

## Required Screenshots

### 1. Hero Shot - Atlas Orb

**File:** `screenshots/hero-orb.png`
**Resolution:** 1920x1080 (16:9)
**Description:** The Atlas orb in its idle state with subtle cyan glow

**Capture Instructions:**

1. Launch Atlas with `npm run dev`
2. Wait for idle animation to stabilize
3. Take screenshot of the full window
4. Crop to show just the orb with slight padding

---

### 2. Orb States Collage

**File:** `screenshots/orb-states.png`
**Resolution:** 2400x600 (4 images @ 600x600 each)
**Description:** Side-by-side comparison of all orb states

| Panel | State     | Color  | Animation    |
| ----- | --------- | ------ | ------------ |
| 1     | Idle      | Cyan   | Gentle orbit |
| 2     | Listening | Green  | Expanding    |
| 3     | Thinking  | Purple | Swirling     |
| 4     | Speaking  | Orange | Pulsing      |

**Capture Instructions:**

1. Take individual screenshots of each state
2. Combine in image editor with consistent sizing
3. Add subtle labels below each state

---

### 3. Settings Panel

**File:** `screenshots/settings.png`
**Resolution:** 800x600
**Description:** The settings panel showing configuration options

**Sections to include:**

- Voice settings (input device, sensitivity)
- Personality sliders
- Quality presets
- API key configuration (masked)

---

### 4. Onboarding Flow

**Files:**

- `screenshots/onboarding-1-welcome.png`
- `screenshots/onboarding-2-apikeys.png`
- `screenshots/onboarding-3-mictest.png`
  **Resolution:** 800x600 each
  **Description:** First-time user experience

---

### 5. System Tray

**File:** `screenshots/system-tray.png`
**Resolution:** 400x500
**Description:** System tray menu with all options visible

**Capture Instructions:**

1. Right-click the Atlas tray icon
2. Screenshot the entire menu
3. Crop with slight padding

---

### 6. Conversation Example

**File:** `screenshots/conversation.png`
**Resolution:** 1200x800
**Description:** A sample conversation showing transcript and orb response

**Sample Dialogue:**

- User: "Hey Atlas, what's the weather like today?"
- Atlas: [Thinking state screenshot]
- Atlas: [Speaking state with transcript visible]

---

### 7. Git Integration

**File:** `screenshots/git-tools.png`
**Resolution:** 1200x800
**Description:** Git status or commit flow visualization

---

### 8. Platform Montage

**File:** `screenshots/platforms.png`
**Resolution:** 2400x800
**Description:** Atlas running on Windows, macOS, and Linux side-by-side

---

## Demo Video Outline

### Short Demo (60 seconds)

**File:** `demos/atlas-demo-60s.mp4`
**Resolution:** 1920x1080 @ 60fps
**Format:** MP4 (H.264)

**Script:**

```
0:00-0:05 - Atlas logo fade in
0:05-0:10 - App launch, orb appears
0:10-0:20 - "Hey Atlas, what can you do?"
           - Show listening state transition
           - Show thinking state
           - Show speaking with audio
0:20-0:35 - Quick feature montage:
           - Settings panel
           - Different orb states
           - System tray
0:35-0:50 - "Hey Atlas, help me commit my changes"
           - Show git integration
0:50-0:60 - Atlas logo + "Download Now" CTA
```

---

### Feature Showcase (3 minutes)

**File:** `demos/atlas-features-3m.mp4`
**Resolution:** 1920x1080 @ 60fps

**Sections:**

1. **Introduction** (0:00-0:30)
   - What is Atlas?
   - Voice-first AI assistant

2. **Voice Pipeline** (0:30-1:15)
   - Wake word detection
   - Natural conversation
   - Barge-in demonstration
   - Offline fallback

3. **Visual Orb** (1:15-1:45)
   - State transitions
   - Audio reactivity
   - Quality settings

4. **Intelligence** (1:45-2:15)
   - Conversation memory
   - Personality customization
   - Skill examples

5. **Developer Tools** (2:15-2:45)
   - Git integration
   - Terminal access

6. **Conclusion** (2:45-3:00)
   - Download CTA
   - Links

---

## GIF Animations

### Orb States Animation

**File:** `gifs/orb-states.gif`
**Resolution:** 400x400
**Duration:** 8 seconds (2s per state)
**Description:** Smooth loop through all orb states

---

### Wake Word Activation

**File:** `gifs/wake-word.gif`
**Resolution:** 600x400
**Duration:** 5 seconds
**Description:** Orb reacting to "Hey Atlas"

---

### Thinking to Speaking

**File:** `gifs/thinking-speaking.gif`
**Resolution:** 400x400
**Duration:** 4 seconds
**Description:** Purple thinking transitioning to orange speaking

---

## Social Media Assets

### Twitter/X Card

**File:** `social/twitter-card.png`
**Resolution:** 1200x628
**Content:**

- Atlas orb on dark background
- Tagline: "Your voice-first AI assistant"
- Atlas logo

---

### LinkedIn Banner

**File:** `social/linkedin-banner.png`
**Resolution:** 1584x396
**Content:**

- Wide orb visualization
- Feature callouts

---

### GitHub Social Preview

**File:** `social/github-preview.png`
**Resolution:** 1280x640
**Content:**

- Atlas orb centered
- "Atlas Desktop" text
- "Voice-First AI Assistant"

---

## Directory Structure

```
assets/
├── screenshots/
│   ├── hero-orb.png
│   ├── orb-states.png
│   ├── settings.png
│   ├── onboarding-1-welcome.png
│   ├── onboarding-2-apikeys.png
│   ├── onboarding-3-mictest.png
│   ├── system-tray.png
│   ├── conversation.png
│   ├── git-tools.png
│   └── platforms.png
├── demos/
│   ├── atlas-demo-60s.mp4
│   └── atlas-features-3m.mp4
├── gifs/
│   ├── orb-states.gif
│   ├── wake-word.gif
│   └── thinking-speaking.gif
└── social/
    ├── twitter-card.png
    ├── linkedin-banner.png
    └── github-preview.png
```

---

## Capture Tools

### Screenshots

- **Windows:** ShareX, Greenshot
- **macOS:** CleanShot X, native screenshot (Cmd+Shift+4)
- **Linux:** Flameshot, GNOME Screenshot

### Screen Recording

- **Cross-platform:** OBS Studio
- **macOS:** ScreenFlow, native recording
- **Windows:** NVIDIA ShadowPlay, Xbox Game Bar

### GIF Creation

- **ScreenToGif** (Windows)
- **Gifski** (macOS)
- **Peek** (Linux)

### Post-Processing

- **Figma** - Mockups and social assets
- **GIMP/Photoshop** - Image editing
- **FFmpeg** - Video processing

---

## Style Guidelines

### Colors

- **Primary:** #00FFFF (Cyan) - Idle orb
- **Listening:** #00FF88 (Green)
- **Thinking:** #9966FF (Purple)
- **Speaking:** #FF8844 (Orange)
- **Background:** #0A0A0F (Dark)
- **Text:** #FFFFFF (White)

### Typography

- **Headings:** Inter Bold
- **Body:** Inter Regular
- **Code:** JetBrains Mono

### Logo Usage

- Minimum size: 32px height
- Clear space: 1x logo height on all sides
- Dark backgrounds only (logo is light)

---

## Checklist

- [ ] Hero screenshot captured
- [ ] Orb states collage created
- [ ] Settings panel screenshot
- [ ] Onboarding flow screenshots (3)
- [ ] System tray screenshot
- [ ] Conversation example screenshot
- [ ] Git integration screenshot
- [ ] Platform montage created
- [ ] 60-second demo recorded
- [ ] 3-minute feature showcase recorded
- [ ] GIF animations created (3)
- [ ] Social media assets created (3)
- [ ] All assets in correct directories
- [ ] README updated with screenshots
