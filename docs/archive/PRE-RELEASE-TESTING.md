# Pre-Release Testing Protocol

Structured testing protocol to execute before each Atlas Desktop release.

---

## Overview

This document defines the testing protocol for validating Atlas Desktop before public release. Follow this protocol sequentially; do not skip sections.

**Time Required:** 4-6 hours per platform
**Testers Required:** 1-2 per platform

---

## Phase 1: Environment Setup (30 minutes)

### 1.1 Clean Machine Preparation

- [ ] Use a clean VM or freshly installed machine
- [ ] No previous version of Atlas installed
- [ ] Standard user account (not admin, except for install)
- [ ] Network connected and stable
- [ ] Microphone and speakers available

### 1.2 Download & Install

```bash
# Download the release candidate
# Use the exact files that will be published

# Windows
atlas-0.2.0-setup.exe

# macOS
atlas-0.2.0.dmg

# Linux
atlas-0.2.0.AppImage
# or
atlas-0.2.0.deb
```

### 1.3 Environment Variables

Create `.env` file with test API keys:

```
PORCUPINE_API_KEY=test_porcupine_key
DEEPGRAM_API_KEY=test_deepgram_key
FIREWORKS_API_KEY=test_fireworks_key
ELEVENLABS_API_KEY=test_elevenlabs_key
```

**Important:** Use dedicated test accounts with limited quotas to avoid unexpected costs.

---

## Phase 2: Installation Testing (30 minutes)

### 2.1 Fresh Install

| Test               | Steps                      | Expected                          | Result |
| ------------------ | -------------------------- | --------------------------------- | ------ |
| Download completes | Download from release page | File downloads without error      |        |
| File integrity     | Verify checksum            | SHA256 matches published          |        |
| Install prompts    | Run installer              | Appropriate permissions requested |        |
| Install completes  | Finish installation        | No errors, app installed          |        |
| First launch       | Open Atlas                 | Onboarding wizard appears         |        |

### 2.2 Upgrade Install (if applicable)

| Test               | Steps                          | Expected                       | Result |
| ------------------ | ------------------------------ | ------------------------------ | ------ |
| Previous version   | Install previous release first | v0.1.0 working                 |        |
| Upgrade process    | Install new version over old   | Upgrade completes              |        |
| Settings preserved | Open Atlas                     | Previous settings intact       |        |
| Memory preserved   | Check conversation history     | Previous conversations visible |        |

### 2.3 Uninstall

| Test              | Steps                   | Expected                       | Result |
| ----------------- | ----------------------- | ------------------------------ | ------ |
| Uninstall process | Remove Atlas            | Uninstall completes cleanly    |        |
| File cleanup      | Check install directory | No orphaned files              |        |
| Data retention    | Check ~/.atlas/         | User data preserved (expected) |        |
| Re-install        | Install again           | Works correctly                |        |

---

## Phase 3: Core Voice Pipeline (1 hour)

### 3.1 Wake Word Detection

| Test           | Steps                        | Expected                         | Result |
| -------------- | ---------------------------- | -------------------------------- | ------ |
| Basic wake     | Say "Hey Atlas"              | Orb transitions to listening     |        |
| Distance test  | Say from 1m/3m/5m away       | Detection at reasonable distance |        |
| Noise test     | Background noise (music, TV) | Still detects wake word          |        |
| Sensitivity    | Adjust in settings           | Affects detection threshold      |        |
| False positive | Say similar phrases          | Should NOT activate              |        |
| Cooldown       | Say twice quickly            | Only activates once              |        |

### 3.2 Speech Recognition

| Test             | Steps                        | Expected              | Result |
| ---------------- | ---------------------------- | --------------------- | ------ |
| Short phrase     | Say "Hello"                  | Correctly transcribed |        |
| Long sentence    | Say a paragraph              | Full transcription    |        |
| Technical terms  | Say "TypeScript React"       | Correct spelling      |        |
| Numbers          | Say phone/credit card format | Correct digits        |        |
| Silence handling | Pause mid-sentence           | Detects end of speech |        |
| Interim results  | Watch during speaking        | Text updates live     |        |

### 3.3 LLM Response

| Test             | Steps                        | Expected            | Result |
| ---------------- | ---------------------------- | ------------------- | ------ |
| Simple question  | "What is 2+2?"               | Correct answer      |        |
| Complex question | Ask multi-step problem       | Reasonable response |        |
| Context test     | Reference previous answer    | Context maintained  |        |
| Long response    | Ask for detailed explanation | Streams correctly   |        |
| Timeout test     | During high latency          | Graceful handling   |        |

### 3.4 Text-to-Speech

| Test           | Steps                         | Expected                  | Result |
| -------------- | ----------------------------- | ------------------------- | ------ |
| Short response | Get brief answer              | Clear audio playback      |        |
| Long response  | Get detailed answer           | Streaming audio works     |        |
| Audio quality  | Listen carefully              | No artifacts/crackling    |        |
| Volume         | System volume changes         | Audio adjusts accordingly |        |
| Interrupt      | Say "Hey Atlas" during speech | TTS stops                 |        |

### 3.5 Full Pipeline

| Test             | Steps                       | Expected              | Result |
| ---------------- | --------------------------- | --------------------- | ------ |
| Complete flow    | Wake → Question → Answer    | All states transition |        |
| Rapid succession | 5 questions in a row        | All handled correctly |        |
| Error recovery   | Disconnect network mid-flow | Graceful fallback     |        |

---

## Phase 4: Visual Orb (30 minutes)

### 4.1 State Transitions

| Test            | Steps             | Expected              | Result |
| --------------- | ----------------- | --------------------- | ------ |
| Idle state      | Observe on launch | Cyan, gentle movement |        |
| Listening state | Trigger wake word | Green, expansion      |        |
| Thinking state  | Ask a question    | Purple, swirl         |        |
| Speaking state  | Get response      | Orange, pulse         |        |
| Return to idle  | After response    | Cyan, settles         |        |

### 4.2 Audio Reactivity

| Test            | Steps                 | Expected              | Result |
| --------------- | --------------------- | --------------------- | ------ |
| Bass response   | Play bass-heavy audio | Particles expand      |        |
| Treble response | Play high frequencies | Rotation increases    |        |
| TTS reactivity  | Get Atlas response    | Orb pulses with voice |        |

### 4.3 Performance

| Test                  | Steps                      | Expected                  | Result |
| --------------------- | -------------------------- | ------------------------- | ------ |
| FPS at idle           | Check FPS counter          | 60fps                     |        |
| FPS during transition | Watch during state changes | No drops below 30         |        |
| Memory at idle        | Check memory usage         | <200MB                    |        |
| Memory after 1 hour   | Leave running              | No significant growth     |        |
| Quality presets       | Change Low→Ultra           | Visual difference visible |        |

---

## Phase 5: Features (1 hour)

### 5.1 Settings

| Test           | Steps             | Expected           | Result |
| -------------- | ----------------- | ------------------ | ------ |
| Open settings  | Click gear icon   | Panel opens        |        |
| Voice settings | Change mic device | Takes effect       |        |
| Personality    | Adjust sliders    | Affects responses  |        |
| Quality        | Change preset     | Orb updates        |        |
| API keys       | View/edit keys    | Securely stored    |        |
| Close settings | Click outside     | Panel closes       |        |
| Persistence    | Restart app       | Settings preserved |        |

### 5.2 System Tray

| Test        | Steps               | Expected           | Result |
| ----------- | ------------------- | ------------------ | ------ |
| Tray icon   | Look in system tray | Icon visible       |        |
| Menu        | Right-click icon    | Menu appears       |        |
| Show window | Click "Show"        | Window appears     |        |
| Mute toggle | Click mute option   | Microphone toggles |        |
| Quit        | Click "Quit"        | App exits cleanly  |        |

### 5.3 Keyboard Shortcuts

| Test          | Steps            | Expected            | Result |
| ------------- | ---------------- | ------------------- | ------ |
| Push-to-talk  | Ctrl+Shift+Space | Activates listening |        |
| Mute toggle   | Ctrl+Shift+M     | Toggles microphone  |        |
| Open settings | Ctrl+Shift+S     | Opens settings      |        |
| Escape        | While speaking   | Stops TTS           |        |

### 5.4 Git Tools (if enabled)

| Test       | Steps                       | Expected           | Result |
| ---------- | --------------------------- | ------------------ | ------ |
| Git status | "What's the git status?"    | Shows repo state   |        |
| Git diff   | "What did I change?"        | Shows diff summary |        |
| Git commit | "Commit with message test"  | Creates commit     |        |
| Git branch | "Create branch test-branch" | Creates branch     |        |

### 5.5 Skills

| Test       | Steps                    | Expected              | Result |
| ---------- | ------------------------ | --------------------- | ------ |
| Calculator | "What is 15% of 230?"    | Correct answer        |        |
| Timer      | "Set timer for 1 minute" | Timer starts          |        |
| Weather    | "What's the weather?"    | Weather info (if API) |        |

---

## Phase 6: Error Handling (30 minutes)

### 6.1 Network Errors

| Test               | Steps              | Expected               | Result |
| ------------------ | ------------------ | ---------------------- | ------ |
| No internet        | Disconnect network | Fallback to offline    |        |
| Slow connection    | Throttle network   | Graceful degradation   |        |
| Connection restore | Reconnect          | Returns to online mode |        |

### 6.2 API Errors

| Test            | Steps              | Expected              | Result |
| --------------- | ------------------ | --------------------- | ------ |
| Invalid API key | Use wrong key      | User-friendly error   |        |
| Rate limited    | Exhaust quota      | Backoff and retry     |        |
| Service down    | Block API endpoint | Circuit breaker trips |        |

### 6.3 Audio Errors

| Test             | Steps                | Expected              | Result |
| ---------------- | -------------------- | --------------------- | ------ |
| No microphone    | Disable mic          | Clear error message   |        |
| Mic disconnected | Unplug during use    | Graceful handling     |        |
| No speakers      | Disable audio output | Falls back gracefully |        |

### 6.4 Recovery

| Test            | Steps                    | Expected              | Result |
| --------------- | ------------------------ | --------------------- | ------ |
| Crash recovery  | Force kill app           | Restarts cleanly      |        |
| State recovery  | Kill during conversation | Resumes appropriately |        |
| Memory recovery | Corrupt memory file      | Handles gracefully    |        |

---

## Phase 7: Accessibility (30 minutes)

### 7.1 Keyboard Navigation

| Test             | Steps             | Expected               | Result |
| ---------------- | ----------------- | ---------------------- | ------ |
| Tab navigation   | Tab through UI    | All elements reachable |        |
| Focus indicators | Tab through       | Focus visible          |        |
| Enter activation | Enter on buttons  | Activates control      |        |
| Escape cancel    | Escape in dialogs | Closes dialog          |        |

### 7.2 Screen Reader

| Test              | Steps              | Expected           | Result |
| ----------------- | ------------------ | ------------------ | ------ |
| NVDA (Windows)    | Navigate with NVDA | Elements announced |        |
| VoiceOver (macOS) | Navigate with VO   | Elements announced |        |
| Orca (Linux)      | Navigate with Orca | Elements announced |        |
| Live regions      | State changes      | Announced to user  |        |

### 7.3 Visual

| Test           | Steps              | Expected            | Result |
| -------------- | ------------------ | ------------------- | ------ |
| High contrast  | Enable in settings | UI remains usable   |        |
| Reduced motion | Enable in settings | Animations disabled |        |
| Font scaling   | Increase font size | UI adapts           |        |

---

## Phase 8: Performance Benchmarks (30 minutes)

### 8.1 Timing Metrics

Record actual values:

| Metric            | Target | Actual | Pass/Fail |
| ----------------- | ------ | ------ | --------- |
| Cold start        | <5s    |        |           |
| Warm start        | <2s    |        |           |
| Wake word latency | <200ms |        |           |
| STT latency       | <300ms |        |           |
| LLM first token   | <2s    |        |           |
| TTS first audio   | <500ms |        |           |
| Total response    | <3s    |        |           |

### 8.2 Resource Usage

| Metric          | Target | Actual | Pass/Fail |
| --------------- | ------ | ------ | --------- |
| Memory (idle)   | <200MB |        |           |
| Memory (active) | <500MB |        |           |
| CPU (idle)      | <5%    |        |           |
| GPU (idle)      | <10%   |        |           |
| Orb FPS         | 60fps  |        |           |

---

## Phase 9: Final Sign-Off

### Test Summary

| Phase             | Tests | Passed | Failed | Blocked |
| ----------------- | ----- | ------ | ------ | ------- |
| 1. Environment    |       |        |        |         |
| 2. Installation   |       |        |        |         |
| 3. Voice Pipeline |       |        |        |         |
| 4. Visual Orb     |       |        |        |         |
| 5. Features       |       |        |        |         |
| 6. Error Handling |       |        |        |         |
| 7. Accessibility  |       |        |        |         |
| 8. Performance    |       |        |        |         |
| **TOTAL**         |       |        |        |         |

### Critical Issues Found

| #   | Description | Severity | Blocker? |
| --- | ----------- | -------- | -------- |
| 1   |             |          |          |
| 2   |             |          |          |
| 3   |             |          |          |

### Tester Sign-Off

| Tester | Platform | Date | Approval |
| ------ | -------- | ---- | -------- |
|        | Windows  |      |          |
|        | macOS    |      |          |
|        | Linux    |      |          |

### Final Recommendation

- [ ] **APPROVED FOR RELEASE** - All critical tests passed
- [ ] **CONDITIONAL APPROVAL** - Minor issues documented, proceed with caution
- [ ] **NOT APPROVED** - Critical issues must be resolved

---

**Tested By:** ******\_\_\_\_******
**Date:** ******\_\_\_\_******
**Version:** ******\_\_\_\_******
