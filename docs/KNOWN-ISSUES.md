# Known Issues by Platform

This document tracks platform-specific issues, workarounds, and limitations in Atlas Desktop.

---

## Windows

### Microphone Access

**Issue:** Windows may not prompt for microphone permission on first launch.
**Workaround:** Open Windows Settings > Privacy > Microphone, and ensure Atlas is allowed.
**Status:** Expected Windows behavior

### Windows Defender SmartScreen

**Issue:** SmartScreen may warn about "unrecognized app" on first run.
**Workaround:** Click "More info" → "Run anyway". This occurs because the app is new and not yet widely distributed.
**Status:** Will improve as app gains reputation

### Global Hotkeys with Admin Apps

**Issue:** Global hotkeys may not work when an admin-elevated window has focus.
**Workaround:** None - this is a Windows security feature.
**Status:** By design

### High DPI Scaling (>150%)

**Issue:** Some UI elements may appear blurry at very high DPI settings.
**Workaround:** Set Windows scaling to 150% or lower, or enable "Override high DPI scaling" in app properties.
**Status:** Under investigation

### Windows on ARM

**Issue:** Native ARM64 build not yet available; x64 build runs via emulation.
**Workaround:** Use the x64 installer - it will run via Windows' x64 emulation layer.
**Status:** ARM64 native build planned for future release

---

## macOS

### Gatekeeper Warning

**Issue:** macOS may show "Atlas cannot be opened because it is from an unidentified developer."
**Workaround:** Right-click the app → Open, or go to System Preferences > Security & Privacy and click "Open Anyway."
**Status:** Will be resolved when we complete Apple notarization

### Microphone Permission

**Issue:** macOS requires explicit microphone permission grant.
**Workaround:** Grant permission when prompted, or go to System Preferences > Security & Privacy > Privacy > Microphone.
**Status:** Expected macOS behavior

### Screen Recording Permission (for Screenshot Tool)

**Issue:** Screenshot tool requires screen recording permission on macOS.
**Workaround:** Grant permission in System Preferences > Security & Privacy > Privacy > Screen Recording.
**Status:** Expected macOS behavior

### Apple Silicon (M1/M2/M3) - Rosetta

**Issue:** Some native node modules may not have ARM64 builds.
**Workaround:** Install Rosetta 2 (`softwareupdate --install-rosetta`). The app will automatically use it when needed.
**Status:** Most dependencies now have native ARM64 support

### Menu Bar Spacing

**Issue:** On macOS, the menu bar icon may appear too close to other icons on some displays.
**Workaround:** None currently. Try adjusting menu bar icon order using third-party tools like Bartender.
**Status:** Low priority

### Monterey Bluetooth Audio

**Issue:** On macOS Monterey, Bluetooth audio devices may have delayed switching.
**Workaround:** Manually select the audio device in Settings before starting a conversation.
**Status:** Apple bug, partially fixed in macOS Ventura+

---

## Linux

### AppImage FUSE Requirement

**Issue:** AppImages require FUSE to run, which may not be installed on some minimal distributions.
**Workaround:** Install fuse2: `sudo apt install libfuse2` (Ubuntu/Debian) or `sudo dnf install fuse` (Fedora).
**Status:** Expected AppImage behavior

### Wayland Global Hotkeys

**Issue:** Global hotkeys may not work under pure Wayland sessions due to Wayland security model.
**Workaround:** Use XWayland mode, or use the system tray icon to activate Atlas.
**Status:** Partial support added via D-Bus

### PulseAudio vs PipeWire

**Issue:** Audio device enumeration may differ between PulseAudio and PipeWire.
**Workaround:** If audio devices are not appearing, check that PulseAudio compatibility layer is enabled for PipeWire.
**Status:** Testing on PipeWire improved

### System Tray Not Available

**Issue:** Some Linux desktop environments (e.g., vanilla GNOME) do not have system tray support.
**Workaround:** Install a system tray extension (e.g., AppIndicator and KStatusNotifierItem Support for GNOME).
**Status:** Expected on affected DEs

### Audio on Fedora with SELinux

**Issue:** SELinux may block microphone access in some Fedora configurations.
**Workaround:** Add an SELinux exception or run in permissive mode for testing.
**Status:** Under investigation

### Ubuntu 24.04 AppArmor

**Issue:** AppArmor profiles may restrict Atlas on Ubuntu 24.04.
**Workaround:** Add an AppArmor exception if needed.
**Status:** Under investigation

### Nvidia GPU on Wayland

**Issue:** Orb visualization may have issues on Nvidia GPUs with Wayland.
**Workaround:** Use X11 session, or ensure nvidia-drm.modeset=1 kernel parameter is set.
**Status:** Nvidia driver improvements ongoing

---

## All Platforms

### Large Files in Git

**Issue:** Git operations may be slow with repositories containing large files (>100MB).
**Workaround:** Use Git LFS for large files.
**Status:** Performance optimization planned

### API Rate Limits

**Issue:** Heavy usage may trigger rate limits on Deepgram, ElevenLabs, or Fireworks AI.
**Workaround:** Enable budget enforcement in Settings to prevent unexpected usage.
**Status:** By design

### Offline Mode Limitations

**Issue:** Offline STT (Vosk) and TTS (Piper) have lower quality than online services.
**Workaround:** None - this is a tradeoff of offline processing.
**Status:** Expected behavior

### Memory Usage with Long Sessions

**Issue:** Memory usage may grow during very long sessions (8+ hours) due to conversation history.
**Workaround:** Restart Atlas periodically, or enable memory consolidation in Settings.
**Status:** Memory optimization ongoing

### WebGL Compatibility

**Issue:** Very old or unsupported GPUs may not render the orb correctly.
**Workaround:** Enable software rendering in Settings, or upgrade GPU drivers.
**Status:** Fallback renderer planned

---

## Reporting New Issues

When reporting a new platform-specific issue:

1. **Platform Details**
   - OS name and version
   - Architecture (x64, ARM64)
   - Desktop environment (for Linux)

2. **Hardware**
   - CPU model
   - GPU model and driver version
   - RAM amount
   - Audio devices

3. **Reproduction Steps**
   - Exact steps to reproduce
   - Expected vs actual behavior

4. **Logs**
   - Attach logs from `~/.atlas/logs/`
   - Include console output if available

5. **Screenshots/Videos**
   - If it's a visual issue, attach screenshots
   - For timing issues, a screen recording helps

**Submit issues at:** [GitHub Issues](https://github.com/benedict-anokye-davies/atlas-ai/issues)

---

## Issue Severity

| Level       | Description                | Example                 |
| ----------- | -------------------------- | ----------------------- |
| Critical    | App won't start or crashes | Startup crash on Ubuntu |
| High        | Core feature broken        | Wake word never detects |
| Medium      | Feature degraded           | Audio quality reduced   |
| Low         | Minor inconvenience        | UI spacing slightly off |
| Enhancement | Improvement request        | Better hotkey options   |

---

## Version History

| Version | Platform Issues Fixed                  |
| ------- | -------------------------------------- |
| 0.2.0   | Initial platform support documentation |
| 0.1.0   | Initial release                        |

---

_Last updated: January 15, 2026_
