# Perplexity Research Prompts for Nova Desktop

Use these prompts with Perplexity AI to get expert recommendations for improving this project.

---

## 1. Performance Optimization

```
I'm building an Electron desktop app called Nova - a voice-first AI assistant with:
- Real-time wake word detection (Porcupine)
- Voice Activity Detection (Silero VAD)
- Streaming STT (Deepgram primary, Vosk offline fallback)
- LLM integration (Fireworks AI primary, OpenRouter fallback)
- Streaming TTS (ElevenLabs primary, Piper/espeak offline fallback)
- React Three Fiber 3D particle visualization (30K particles with bloom post-processing)

Current tech stack: Electron 28, React 18, TypeScript 5.3, Vite 5, Three.js 0.160

Questions:
1. What are best practices for reducing Electron app memory usage with continuous audio processing?
2. How can I optimize Three.js/R3F particle systems with 30K+ particles to maintain 60fps?
3. What's the most efficient way to handle real-time audio streaming between Node.js main process and React renderer?
4. Are there any Electron-specific optimizations for voice assistant apps I should implement?
5. How should I handle GPU acceleration for the 3D visualization without draining battery?
```

---

## 2. Audio Pipeline Architecture

```
I'm building a voice assistant desktop app with this audio pipeline:

Microphone → Wake Word (Porcupine) → VAD (Silero) → STT (Deepgram streaming) → LLM → TTS (ElevenLabs streaming) → Speaker

Current issues I want to avoid:
- Audio latency between components
- Handling barge-in (user interrupts while TTS is playing)
- Graceful degradation when cloud services fail
- Echo cancellation when using speakers

Questions:
1. What's the optimal audio buffer size for real-time voice processing in Node.js?
2. How do professional voice assistants (Alexa, Siri) handle barge-in detection?
3. What's the best architecture for seamless cloud-to-local fallback in voice pipelines?
4. How should I implement acoustic echo cancellation in Electron?
5. Are there any Node.js audio libraries better than the native AudioWorklet for this use case?
```

---

## 3. LLM Function Calling Best Practices

```
I'm implementing LLM-driven tool execution in a voice assistant. The LLM (Fireworks AI with DeepSeek/Llama models or OpenRouter with Claude) receives voice transcripts and can call tools like:

- read_file, write_file, search_files (filesystem)
- execute_command, npm, git (terminal)
- web_search, fetch_url (search)
- capture_screen, capture_window (screenshot)
- clipboard operations

Current implementation:
- OpenAI-compatible function calling format
- Tool results sent back to LLM for final response
- Max 5 tool iterations per request

Questions:
1. What are best practices for LLM tool calling in production voice assistants?
2. How should I handle tool execution timeouts without leaving the user waiting?
3. What's the best way to summarize tool results for voice output (TTS)?
4. How do I prevent prompt injection through user voice commands?
5. Should I use ReAct prompting, function calling, or a hybrid approach?
6. How can I make the LLM better at deciding when NOT to use tools?
```

---

## 4. Security Hardening

```
I'm building an Electron voice assistant with these capabilities:
- File system access (read, write, delete files)
- Terminal command execution
- Browser automation (Playwright)
- Screenshot capture
- Clipboard access
- Web search

Current security measures:
- Path validation (no access outside user home)
- Command blocklist (rm -rf, format, etc.)
- URL validation for web requests
- IPC channel validation in preload script
- Context isolation enabled

Questions:
1. What additional security measures should I implement for an AI-powered desktop assistant?
2. How do I safely sandbox terminal command execution in Electron?
3. What's the best approach for permission management (granular user consent)?
4. How should I handle and log potentially dangerous operations?
5. Are there Electron security best practices specific to AI assistants I should follow?
6. How do I protect against prompt injection attacks in voice-to-text pipelines?
```

---

## 5. Offline/Hybrid Mode Architecture

```
My voice assistant has these cloud/local fallback pairs:
- STT: Deepgram (cloud) → Vosk (local)
- LLM: Fireworks AI (cloud) → ??? (need recommendation)
- TTS: ElevenLabs (cloud) → Piper/espeak (local)

Current fallback is triggered by circuit breaker (3 failures → switch to fallback for 60s).

Questions:
1. What's the best local/offline LLM for a desktop assistant? (considering Ollama, llama.cpp, etc.)
2. How should I detect network quality to proactively switch to offline mode?
3. What's the optimal circuit breaker configuration for voice assistants?
4. How can I provide a consistent user experience when switching between cloud and local providers?
5. Should I run local models in a separate process to avoid blocking the main thread?
6. What's the best Vosk model for conversational English STT?
```

---

## 6. React Three Fiber Optimization

```
I have a 3D AI orb visualization in React Three Fiber with:
- 4 particle layers (30K total particles)
  - Inner nucleus: 8K cyan particles
  - Outer shell: 12K gold particles
  - 2 orbital rings: 5K particles each
- Custom GLSL shaders with curl noise animation
- Post-processing: Bloom, Vignette, Noise
- State-based animations (idle/listening/thinking/speaking)
- Running in Electron renderer process

Questions:
1. What are the best R3F performance optimizations for particle systems?
2. Should I use instanced meshes instead of Points for this many particles?
3. How can I reduce GPU memory usage while maintaining visual quality?
4. What's the best way to handle WebGL context loss in Electron?
5. Are there R3F-specific patterns for smooth state transitions with shaders?
6. How should I handle the bloom post-processing performance impact?
```

---

## 7. Testing Strategy for Voice Apps

```
I'm testing a voice assistant desktop app with:
- 881 unit/integration tests (Vitest)
- Main process: voice pipeline, STT, LLM, TTS, agent tools
- Renderer: React components, 3D visualization, state management

Current testing gaps:
- No e2e tests for full voice flow
- Difficult to test audio input/output
- Mocking cloud APIs is complex
- Can't easily test 3D rendering

Questions:
1. How do professional teams test voice assistant applications end-to-end?
2. What's the best approach for mocking audio input in Node.js tests?
3. How should I test LLM-based features without hitting real APIs?
4. Are there tools for visual regression testing of Three.js/WebGL?
5. How do I test real-time streaming (STT, TTS) effectively?
6. What's a good test coverage target for voice applications?
```

---

## 8. Electron IPC Best Practices

```
My Electron app has this IPC architecture:
- Main process: voice pipeline, file ops, terminal, browser automation
- Renderer: React UI, 3D visualization
- Preload: exposes safe API via contextBridge

Current IPC channels:
- voice:start, voice:stop, voice:getState
- voice:state, voice:transcript, voice:response (events)
- nova:get-conversation-history, nova:clear-memory
- nova:tool-start, nova:tool-complete, nova:tool-error
- File, clipboard, screenshot operations

Questions:
1. What's the best pattern for high-frequency IPC (audio level updates, particles)?
2. How should I handle IPC timeouts for long-running operations?
3. Are there performance implications of using ipcRenderer.on vs ipcRenderer.invoke?
4. How do I prevent IPC channel flooding from audio/animation data?
5. What's the recommended way to type IPC channels in TypeScript?
6. Should I use MessagePorts for streaming data instead of regular IPC?
```

---

## 9. Memory Management

```
My Electron voice assistant stores:
- Conversation history in JSON (~/.nova/memory/memory.json)
- Audio buffers during recording
- LLM context window (messages array)
- 3D particle positions (30K * 3 floats * 4 layers)

Concerns:
- Memory leaks from event listeners
- Growing conversation history
- Audio buffer cleanup
- WebGL memory management

Questions:
1. What's the best approach for persistent conversation memory in AI assistants?
2. How should I limit memory growth for long-running voice assistant sessions?
3. What are common memory leak patterns in Electron apps I should avoid?
4. How do I properly clean up Three.js/WebGL resources?
5. Should I use SQLite instead of JSON for conversation storage?
6. What memory profiling tools work best for Electron apps?
```

---

## 10. User Experience Improvements

```
My voice assistant has these UX elements:
- 3D animated orb that changes based on state (idle/listening/thinking/speaking)
- System tray with push-to-talk
- Keyboard shortcuts (Space=wake, Escape=cancel, Ctrl+,=settings)
- Settings modal for configuration
- Conversation transcript display

Missing features I want to add:
- Visual feedback for audio levels
- Better error state communication
- Accessibility support
- Multi-monitor support
- Global hotkeys

Questions:
1. What UX patterns do successful voice assistants use for visual feedback?
2. How should errors be communicated in a voice-first interface?
3. What accessibility considerations are important for voice assistant apps?
4. How do I implement global hotkeys in Electron that work when app is minimized?
5. What's the best way to show "listening" and "thinking" states visually?
6. Should I add a text input fallback for when voice isn't appropriate?
```

---

## 11. Deployment & Distribution

```
My Electron app uses:
- electron-builder for packaging
- NSIS installer for Windows
- DMG for macOS
- AppImage for Linux

Current build output:
- Renderer: 1,383 KB
- Main: 843 KB
- Total installer: ~150 MB (includes node_modules)

Questions:
1. How can I reduce the Electron app bundle size?
2. What's the best approach for auto-updates in Electron?
3. How should I handle code signing for Windows and macOS?
4. Are there cloud services for distributing Electron apps?
5. How do I handle native dependencies (Porcupine, Vosk) across platforms?
6. What's the best way to handle first-run setup (API key configuration)?
```

---

## 12. Advanced Agent Capabilities

```
My voice assistant has 31 agent tools across 6 categories:
- Filesystem (9): read, write, append, delete, list, search, copy, move, mkdir
- Terminal (5): execute, npm, git, pwd, which
- Browser (6): navigate, get_content, click, type, screenshot, close
- Screenshot (3): capture_screen, capture_window, list_sources
- Clipboard (6): read/write text, read/write image, clear, formats
- Search (2): web_search, fetch_url

What I want to add:
- Multi-step task planning
- Learning from user corrections
- Proactive suggestions
- Integration with other apps (calendar, email, etc.)

Questions:
1. How do AI coding assistants (Cursor, Copilot) implement multi-step task planning?
2. What's the best architecture for an AI agent that learns from user feedback?
3. How should I implement "proactive" suggestions without being annoying?
4. What APIs/protocols exist for desktop app integration (calendar, email)?
5. How do I handle complex multi-tool workflows reliably?
6. Should I implement a task queue for background agent operations?
```

---

## Usage Tips

1. **Be Specific**: Add your exact error messages or code snippets for more targeted advice
2. **Follow Up**: Ask "Can you show me example code?" after getting conceptual answers
3. **Compare Options**: Ask "What are the tradeoffs between X and Y?" for decision-making
4. **Request Sources**: Ask for links to documentation, GitHub repos, or articles
5. **Iterate**: Take the best answers and ask deeper follow-up questions

---

## Quick Reference

| Area           | Key Technologies          | Priority |
| -------------- | ------------------------- | -------- |
| Performance    | Electron, Three.js, Audio | HIGH     |
| Security       | Sandboxing, Permissions   | HIGH     |
| Audio Pipeline | WebAudio, Streaming       | HIGH     |
| Offline Mode   | Vosk, Local LLM           | MEDIUM   |
| Testing        | Vitest, Mocking           | MEDIUM   |
| UX             | Visual feedback, A11y     | MEDIUM   |
| Deployment     | electron-builder          | LOW      |
