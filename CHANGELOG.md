# Changelog

All notable changes to Atlas Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-16

### Added

#### Voice Pipeline (Phase 1)

- Wake word detection with "Hey Atlas" activation using Porcupine
- Voice Activity Detection (VAD) using Silero for intelligent speech segmentation
- Speech-to-Text integration with Deepgram (primary) and Vosk (offline fallback)
- LLM integration with Fireworks AI (DeepSeek V3.1) and OpenRouter fallback
- Text-to-Speech with ElevenLabs (primary) and Piper/espeak (offline fallback)
- Adaptive silence detection for natural conversation flow
- "Still listening" state for incomplete sentences
- Echo cancellation with NLMS adaptive filtering
- Connection warmup for reduced first-response latency
- Audio preprocessing with noise gate, high-pass filter, and noise reduction

#### Visual Orb (Phase 2)

- 3D particle visualization using React Three Fiber
- Strange attractor particle system (Aizawa attractor)
- State-based animations and color transitions
  - Idle: Cyan particles, gentle movement
  - Listening: Green particles, responsive expansion
  - Thinking: Purple particles, contemplative swirl
  - Speaking: Orange particles, expressive pulsing
- Audio-reactive particle behavior
- GPU detection and auto-configuration
- Dynamic Level of Detail (LOD) system for 60fps performance
- Quality presets (Low/Medium/High/Ultra)
- Post-processing effects (bloom, glow)
- Instanced rendering for optimal performance

#### Git Tools (Phase 3)

- Git status with rich repository information
- Add, commit, and push operations
- Branch creation, switching, and deletion
- Merge with AI-assisted conflict resolution
- Diff and log viewing
- Stash operations
- Cherry-pick support
- Remote management
- Clone and init operations
- Tag management

#### Memory System (Phase 4)

- Semantic chunking of conversations
- Importance scoring for memory retention
- User preference learning and extraction
- Topic detection and tracking
- Sentiment analysis
- Multi-turn conversation context
- Conversation summarization

#### Onboarding & UX (Phase 5)

- Welcome screen for first-time users
- API key setup wizard
- Microphone test with visual feedback
- Keyboard navigation support
- Screen reader compatibility
- Visual accessibility options (high contrast, reduced motion)
- Loading indicators for async operations
- Progress feedback for long operations
- Keyboard shortcuts help modal

#### Intelligence & Skills (Phase 6)

- Knowledge store for fact storage
- Fact extraction from conversations
- Knowledge retrieval for context enhancement
- Skill system architecture with plugin support
- Built-in skills: Calculator, Timer, Weather
- Automatic skill selection based on query
- Sandboxed tool execution
- Permission system for dangerous operations
- Audit trail and rollback capability
- Background research mode
- Smart notifications
- Task scheduling

#### Platform & Security (Phase 7)

- Enhanced system tray with audio/volume/theme controls
- Global hotkeys (customizable shortcuts)
- Secure storage using system keychain
- Encrypted conversation logs
- Privacy mode (no-logging option)
- Hot Module Replacement for main process
- Debug tools and performance profiler
- Connection warmup manager

#### Testing & Release (Phase 8)

- Comprehensive CI/CD pipeline with GitHub Actions
- Platform builds for Windows, Mac, and Linux
- Code signing support for Windows and macOS
- Auto-update system via electron-updater
- Visual regression testing with Playwright
- Smoke tests for critical paths
- QA test automation script

#### Browser Tools

- Browser launch with CDP integration
- Brave browser auto-detection
- Web navigation and interaction
- Screenshot capture
- Element inspection

#### Desktop Tools

- File system operations (read, write, search)
- Application launching
- Screenshot analysis
- Clipboard management
- Window management

#### Visual Automation Tools

- OCR text extraction using Tesseract.js
  - Extract text from image files
  - Extract text from screenshots
  - Find text location with bounding boxes
  - Multi-language support (14 languages)
  - Word-level confidence scores
- UI template matching for visual automation
  - Find UI elements using template images
  - Wait for UI elements to appear with timeout
  - Save screen regions as templates
  - Multi-scale matching support
  - Normalized Cross-Correlation (NCC) algorithm

#### Dashboard & Workflow

- AGNT-style dashboard layout with metrics bar
- Visual workflow builder with ReactFlow
  - Drag-and-drop node creation
  - Trigger, Action, Condition, and Output node types
  - Properties panel for node configuration
  - Workflow save/load functionality
- Goals tracking panel
- Agents swarm visualization
- Integration status grid
- Run statistics panel

### Changed

- Renamed project from "Nova" to "Atlas"
- Improved personality system with configurable traits
- Enhanced error messages with user-friendly toasts
- Optimized particle rendering for low-end GPUs
- Build script no longer requires strict tsc pass (Vite handles bundling)
- Added ccxt, discord.js, formidable to Vite externals for proper bundling

### Fixed

- Wake word detection reliability improvements
- VAD adaptive silence timeout for natural pauses
- Memory leaks in audio pipeline
- Circuit breaker state persistence
- Test suite stability improvements
  - Fixed pipeline.test.ts mock for setAtlasSpeaking
  - Updated browser/agent tool counts (6 to 8)
  - Fixed security vulnerability test thresholds
  - Fixed load test timeouts and assertions
  - Fixed TTS latency assertion for fast mocks
- QA script TypeScript compilation

## [0.1.0] - 2026-01-10

### Added

- Initial project setup with Electron + React + TypeScript + Vite
- Basic project structure and configuration
- Winston logging system
- Error handling and recovery framework
- Circuit breaker pattern for provider resilience

---

## Release Types

- **Major (X.0.0)**: Breaking changes, major feature additions
- **Minor (0.X.0)**: New features, non-breaking changes
- **Patch (0.0.X)**: Bug fixes, minor improvements

## Links

- [Atlas Desktop Repository](https://github.com/benedict-anokye-davies/atlas-ai)
- [Documentation](./docs/README.md)
- [User Guide](./docs/USER-GUIDE.md)
- [Developer Guide](./docs/DEVELOPER-GUIDE.md)
