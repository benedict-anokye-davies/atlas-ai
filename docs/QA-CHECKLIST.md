# Cross-Platform QA Checklist

Use this checklist to verify Atlas Desktop works correctly on all supported platforms before release.

---

## Test Environments

### Windows

- [ ] Windows 10 (21H2 or later)
- [ ] Windows 11 (22H2 or later)
- [ ] Windows ARM64 (if applicable)

### macOS

- [ ] macOS 11 Big Sur (Intel)
- [ ] macOS 12 Monterey
- [ ] macOS 13 Ventura
- [ ] macOS 14 Sonoma
- [ ] Apple Silicon (M1/M2/M3)

### Linux

- [ ] Ubuntu 22.04 LTS
- [ ] Ubuntu 24.04 LTS
- [ ] Fedora 39+
- [ ] Debian 12+
- [ ] Arch Linux (latest)

---

## Installation Tests

### Windows

| Test                    | Expected Result                       | Pass/Fail | Notes |
| ----------------------- | ------------------------------------- | --------- | ----- |
| Download .exe installer | File downloads without corruption     |           |       |
| Run installer           | UAC prompt appears, install completes |           |       |
| Start menu shortcut     | Atlas appears in Start menu           |           |       |
| Desktop shortcut        | Shortcut created (if selected)        |           |       |
| First launch            | App starts, shows onboarding          |           |       |
| Uninstall               | Clean removal, no leftover files      |           |       |

### macOS

| Test                 | Expected Result                       | Pass/Fail | Notes |
| -------------------- | ------------------------------------- | --------- | ----- |
| Download .dmg        | File downloads, mounts correctly      |           |       |
| Drag to Applications | App copies without error              |           |       |
| Gatekeeper approval  | App runs after security approval      |           |       |
| First launch         | App starts from Applications          |           |       |
| Dock integration     | App icon appears in Dock when running |           |       |
| Move to Trash        | Clean removal                         |           |       |

### Linux

| Test                      | Expected Result                  | Pass/Fail | Notes |
| ------------------------- | -------------------------------- | --------- | ----- |
| Download AppImage         | File downloads correctly         |           |       |
| Set executable permission | chmod +x works                   |           |       |
| Run AppImage              | App launches without FUSE errors |           |       |
| .deb install (Ubuntu)     | dpkg -i installs correctly       |           |       |
| .rpm install (Fedora)     | rpm -i installs correctly        |           |       |
| Desktop integration       | App appears in app menu          |           |       |

---

## Core Functionality Tests

### Wake Word Detection

| Test                                  | Windows | macOS | Linux | Notes                       |
| ------------------------------------- | ------- | ----- | ----- | --------------------------- |
| Say "Hey Atlas" in quiet room         |         |       |       | Should detect within 200ms  |
| Say "Hey Atlas" with background noise |         |       |       | May need higher sensitivity |
| Wake word sensitivity adjustment      |         |       |       | Settings should persist     |
| Wake word cooldown (3s)               |         |       |       | Prevent double trigger      |

### Speech Recognition (STT)

| Test                         | Windows | macOS | Linux | Notes                       |
| ---------------------------- | ------- | ----- | ----- | --------------------------- |
| Short phrase transcription   |         |       |       | "What's the weather?"       |
| Long paragraph transcription |         |       |       | Multiple sentences          |
| Technical terms              |         |       |       | "TypeScript", "React", etc. |
| Interim results display      |         |       |       | Text updates as you speak   |
| Offline fallback (Vosk)      |         |       |       | Disconnect network and test |

### Language Model (LLM)

| Test               | Windows | macOS | Linux | Notes                      |
| ------------------ | ------- | ----- | ----- | -------------------------- |
| Simple question    |         |       |       | "What is 2+2?"             |
| Complex question   |         |       |       | Multi-step reasoning       |
| Context retention  |         |       |       | Remember previous turn     |
| Streaming response |         |       |       | Text appears incrementally |
| Timeout handling   |         |       |       | Network delay simulation   |

### Text-to-Speech (TTS)

| Test                     | Windows | macOS | Linux | Notes                       |
| ------------------------ | ------- | ----- | ----- | --------------------------- |
| Short response playback  |         |       |       | Clear audio, no crackling   |
| Long response playback   |         |       |       | Streaming works smoothly    |
| Voice selection          |         |       |       | Different ElevenLabs voices |
| Offline fallback (Piper) |         |       |       | Disconnect network and test |
| Audio device switching   |         |       |       | Change output mid-playback  |

### Orb Visualization

| Test                       | Windows | macOS | Linux | Notes                    |
| -------------------------- | ------- | ----- | ----- | ------------------------ |
| Orb renders on launch      |         |       |       | No blank screen          |
| Idle animation smooth      |         |       |       | 60fps, no stuttering     |
| Listening state transition |         |       |       | Green color, expansion   |
| Thinking state transition  |         |       |       | Purple color, swirl      |
| Speaking state transition  |         |       |       | Orange color, pulse      |
| Audio reactivity           |         |       |       | Particles respond to TTS |
| Quality preset changes     |         |       |       | Low/Medium/High/Ultra    |

---

## Platform-Specific Tests

### Windows-Specific

| Test                             | Expected Result                   | Pass/Fail | Notes |
| -------------------------------- | --------------------------------- | --------- | ----- |
| System tray icon                 | Icon visible in notification area |           |       |
| Global hotkey (Ctrl+Shift+Space) | Push-to-talk activates            |           |       |
| High DPI display (150%+)         | UI scales correctly               |           |       |
| Windows Defender warning         | No false positive                 |           |       |
| Microphone permissions           | Windows prompts for access        |           |       |

### macOS-Specific

| Test                            | Expected Result                     | Pass/Fail | Notes |
| ------------------------------- | ----------------------------------- | --------- | ----- |
| Menu bar icon                   | Icon visible in menu bar            |           |       |
| Global hotkey (Cmd+Shift+Space) | Push-to-talk activates              |           |       |
| Retina display                  | Sharp rendering                     |           |       |
| Notarization                    | No "unidentified developer" warning |           |       |
| Microphone permissions          | macOS prompts for access            |           |       |
| Privacy & Security approval     | App appears in approved list        |           |       |

### Linux-Specific

| Test                              | Expected Result             | Pass/Fail | Notes |
| --------------------------------- | --------------------------- | --------- | ----- |
| System tray (if available)        | Icon in tray applet         |           |       |
| PulseAudio/PipeWire               | Audio works with both       |           |       |
| Wayland support                   | App runs on Wayland session |           |       |
| X11 support                       | App runs on X11 session     |           |       |
| Global hotkey (Super+Shift+Space) | Works in GNOME/KDE          |           |       |

---

## Audio Device Tests

| Test                    | Windows | macOS | Linux | Notes                 |
| ----------------------- | ------- | ----- | ----- | --------------------- |
| Default microphone      |         |       |       | Works out of box      |
| USB microphone          |         |       |       | External device       |
| Bluetooth headset       |         |       |       | A2DP/HFP profile      |
| Multiple input devices  |         |       |       | Switch in settings    |
| Multiple output devices |         |       |       | Switch speakers       |
| Hot-plug device         |         |       |       | Connect while running |

---

## Performance Tests

| Metric                | Target | Windows | macOS | Linux |
| --------------------- | ------ | ------- | ----- | ----- |
| Cold start time       | <5s    |         |       |       |
| Warm start time       | <2s    |         |       |       |
| Wake word latency     | <200ms |         |       |       |
| STT latency           | <300ms |         |       |       |
| Total response time   | <3s    |         |       |       |
| Orb frame rate        | 60fps  |         |       |       |
| Memory usage (idle)   | <200MB |         |       |       |
| Memory usage (active) | <500MB |         |       |       |
| CPU usage (idle)      | <5%    |         |       |       |

---

## Accessibility Tests

| Test                                | Windows | macOS | Linux | Notes                    |
| ----------------------------------- | ------- | ----- | ----- | ------------------------ |
| Keyboard navigation                 |         |       |       | Tab through all elements |
| Screen reader (NVDA/VoiceOver/Orca) |         |       |       | All elements announced   |
| High contrast mode                  |         |       |       | Text readable            |
| Reduced motion                      |         |       |       | Animations disabled      |
| Font size adjustment                |         |       |       | UI adapts                |

---

## Error Handling Tests

| Test                     | Expected Behavior            | Windows | macOS | Linux |
| ------------------------ | ---------------------------- | ------- | ----- | ----- |
| No internet connection   | Graceful fallback to offline |         |       |       |
| Invalid API key          | User-friendly error message  |         |       |       |
| API rate limit exceeded  | Retry with backoff           |         |       |       |
| Microphone access denied | Clear error + instructions   |         |       |       |
| Out of memory            | Graceful degradation         |         |       |       |
| GPU not available        | Software rendering fallback  |         |       |       |

---

## Security Tests

| Test                     | Windows | macOS | Linux | Notes                               |
| ------------------------ | ------- | ----- | ----- | ----------------------------------- |
| API keys not in logs     |         |       |       | Check log files                     |
| Secure storage working   |         |       |       | Keys in keychain/credential manager |
| Sandbox permissions      |         |       |       | Limited file system access          |
| Auto-update verification |         |       |       | Signed updates only                 |

---

## Upgrade Tests

| Test                       | Windows | macOS | Linux | Notes                |
| -------------------------- | ------- | ----- | ----- | -------------------- |
| Upgrade from v0.1.0        |         |       |       | Settings preserved   |
| Upgrade preserves API keys |         |       |       | No re-entry required |
| Upgrade preserves memory   |         |       |       | Conversations intact |
| Downgrade scenario         |         |       |       | Warn about data loss |

---

## Test Environment Setup

### Windows VM

```powershell
# Enable Hyper-V
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All

# Or use VirtualBox/VMware
# Download Windows 10/11 evaluation ISOs from Microsoft
```

### macOS (Apple Silicon required for macOS VMs)

```bash
# UTM for macOS VMs on Apple Silicon
# Or use real hardware for testing
```

### Linux VMs

```bash
# Ubuntu 22.04
wget https://releases.ubuntu.com/22.04/ubuntu-22.04.3-desktop-amd64.iso

# Fedora 39
wget https://download.fedoraproject.org/pub/fedora/linux/releases/39/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-39-1.5.iso
```

---

## Automated Testing

Run automated platform tests:

```bash
# Run all platform-specific tests
npm run test:platform

# Run Windows-specific tests
npm run test:platform:win

# Run macOS-specific tests
npm run test:platform:mac

# Run Linux-specific tests
npm run test:platform:linux
```

---

## Reporting Issues

When reporting a platform-specific issue:

1. **Platform**: OS version and architecture
2. **Hardware**: CPU, GPU, RAM
3. **Steps to reproduce**: Exact steps taken
4. **Expected result**: What should happen
5. **Actual result**: What actually happened
6. **Logs**: Attach `~/.atlas/logs/` contents
7. **Screenshots**: If visual issue

File issues at: [GitHub Issues](https://github.com/benedict-anokye-davies/atlas-ai/issues)

---

## Sign-Off

| Platform     | Tester | Date | Approval |
| ------------ | ------ | ---- | -------- |
| Windows 10   |        |      |          |
| Windows 11   |        |      |          |
| macOS Intel  |        |      |          |
| macOS ARM    |        |      |          |
| Ubuntu 22.04 |        |      |          |
| Fedora 39    |        |      |          |

**Release Approved:** [ ] Yes / [ ] No
**Approved By:** ******\_\_\_******
**Date:** ******\_\_\_******
