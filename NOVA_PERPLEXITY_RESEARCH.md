# Nova Desktop AI Assistant - Perplexity Research Queries

**Use these queries to research on Perplexity.ai to help development.**

Copy each query into Perplexity and save the results. These cover the most critical unknowns for your project.

---

## 1. VOICE & AUDIO RESEARCH

### Query 1: Wake Word Detection
```
Best wake word detection library for "Hey Nova" custom phrase in Electron app (Node.js)?
Compare: Porcupine vs Vosk vs Snowboy. 
Which has best accuracy for custom wake words?
Can I train my own "Hey Nova" model cheaply?
What's the difference between cloud-based and on-device detection?
```

**Why**: Porcupine is planned but you should verify if Vosk (open-source) is viable alternative.

---

### Query 2: Deepgram for Continuous Lecture Transcription
```
Deepgram Nova-3 real-time STT: Can it handle 1+ hour continuous transcription?
What's the latency? Accuracy in noisy environments (lectures, coffee shops)?
Cost for 10 hours/month of transcription?
Does it auto-detect language switching?
What happens if internet disconnects mid-transcription?
```

**Why**: Planning lecture note-taking feature. Need to verify Deepgram can handle it.

---

### Query 3: ElevenLabs TTS Voice Quality
```
ElevenLabs professional male voices for desktop assistant 2025:
Compare Onyx, Adam, Atlas, Joshua voices - which sounds most professional?
What's the latency for streaming TTS?
Can I use ElevenLabs in a commercial product (desktop app)?
ElevenLabs Pro plan vs Starter - what's the difference?
```

**Why**: Need to choose the best male voice for Nova's personality.

---

### Query 4: Offline TTS Alternative
```
Best open-source offline text-to-speech for male voice that runs on RTX 3060 (6GB VRAM)?
Compare: Coqui XTTS-v2 vs Kokoro vs TacotronDB
Speed vs quality tradeoffs?
Can I fine-tune on voice samples?
How much disk space required?
```

**Why**: Fallback for when ElevenLabs API is down or expensive.

---

### Query 5: Audio Ducking in Electron
```
How to lower system volume when text-to-speech plays in Electron app?
Smooth fade-out over 200ms before speaking?
Resume volume after TTS stops?
Audio ducking on Windows vs Mac vs Linux differences?
```

**Why**: Professional UX - don't blast audio at full volume.

---

## 2. MEMORY & PERSISTENCE RESEARCH

### Query 6: Mem0 for Long-term Memory
```
Mem0 AI memory library 2025: 
How does it compare to other memory systems?
Can I use it offline or does it require Mem0 cloud API?
Open-source vs enterprise licensing?
What's the storage requirement for 1 year of daily conversations?
```

**Why**: Want to understand Mem0's licensing and limitations before committing.

---

### Query 7: LanceDB Vector Database Scale
```
LanceDB performance with 1M+ embeddings:
Query latency at different scales (100K vs 1M vectors)?
Memory footprint on laptop (SSD vs RAM)?
Can it handle concurrent queries?
Best indexing strategy for semantic search?
Comparison with Milvus and Qdrant?
```

**Why**: Need to know if LanceDB can handle years of conversation embeddings.

---

### Query 8: Local Vector Embedding for Privacy
```
Can I use local embedding model instead of OpenAI for privacy?
Best open-source embedding models: sentence-transformers, nomic-embed, others?
Can they run on RTX 3060 during inference?
Quality vs OpenAI embeddings?
```

**Why**: Privacy concern - don't want to send all conversations to OpenAI.

---

## 3. BROWSER AUTOMATION & TOOLS

### Query 9: Playwright in Electron
```
Best practices for Playwright browser automation in Electron app?
Should Playwright run in main process or child process?
Can I embed Chromium in Electron instead of running Playwright separately?
Performance implications?
Security considerations?
```

**Why**: Need to verify Playwright architecture choice for tools.

---

### Query 10: Notion API for Auto-Notes
```
Notion API: Create pages and populate with text automatically?
How to format text with headings, lists, code blocks via API?
Real-time updates from Electron app?
Rate limiting considerations?
```

**Why**: Lecture note-taking feature needs robust Notion integration.

---

## 4. LLM & MODEL SELECTION

### Query 11: Fireworks vs Together AI vs OpenRouter
```
Fireworks AI vs Together.AI vs OpenRouter for Electron desktop app (Jan 2025):
Which has best latency for streaming?
Cheapest for high-volume usage?
Best documentation for real-time streaming?
Fine-tuning capability (Together AI vs others)?
How to handle rate limiting gracefully?
```

**Why**: Critical decision for primary LLM provider.

---

### Query 12: Fine-tuning Qwen 32B on RTX 3060
```
Can Unsloth fine-tune Qwen 2.5 32B on RTX 3060 6GB VRAM?
LoRA rank to fit in memory?
How long does 1 epoch on 10k conversations take?
Can I merge multiple LoRA adapters (code + trading specializations)?
```

**Why**: Want to verify fine-tuning is actually feasible on your hardware.

---

### Query 13: Local Model Fallback
```
Best open-source LLM to run locally on RTX 3060 as fallback?
Qwen 2.5 7B vs Phi-3 vs Llama 3B - which is fastest?
Can they run while Nova is speaking?
How to seamlessly switch between Fireworks and local model?
```

**Why**: Need reliable fallback when APIs are down.

---

## 5. VISUAL ORB & 3D RENDERING

### Query 14: Strange Attractors Performance
```
React Three Fiber: Rendering 50,000 particles smoothly?
Best technique: BufferGeometry vs Points vs InstancedMesh?
GPU instancing for particle animation?
How to make particles responsive to audio (frequency)?
Performance at 60 FPS on laptop GPU?
```

**Why**: Need to verify Orb rendering is achievable at quality level.

---

### Query 15: Attractor Math Implementations
```
Which strange attractor looks "coolest": Lorenz, Aizawa, Thomas, Halvorsen?
Mathematical properties (chaotic, stable, periodic)?
Which transitions smoothly between attractors?
How to synchronize particles with audio input?
GPU compute shaders for particle updates?
```

**Why**: Want to make informed choice about visual design.

---

## 6. AUTONOMOUS RESEARCH & SCHEDULING

### Query 16: Node-Cron for Background Tasks
```
Node-cron in Electron: Run tasks when minimized?
Can cron jobs run in main process without blocking voice?
Best practices for resource-heavy research tasks?
How to prevent research from consuming all bandwidth?
```

**Why**: Need robust background research engine.

---

### Query 17: Free/Cheap Web Search APIs
```
Best APIs for web search in 2025 (HackerNews, ProductHunt, Twitter trends):
Free tier availability?
How to extract key insights programmatically?
SerpAPI vs Perplexity API vs others?
Cost for daily research?
```

**Why**: Want to minimize cost while keeping research useful.

---

## 7. SECURITY & PRIVACY

### Query 18: Secure API Key Storage
```
Electron: Best practice for storing API keys securely?
electron-store with encryption?
OS keychain integration (Windows/Mac/Linux)?
How to prevent key leakage in crash dumps?
Multi-factor key rotation?
```

**Why**: Critical security concern - don't leak API keys.

---

### Query 19: Privacy of Local Conversations
```
Storing conversations locally in Electron app - privacy implications?
What data is sent to Fireworks/Anthropic/OpenAI?
GDPR compliance for personal AI assistant?
Should I offer local-only mode (no cloud)?
Backup strategy for conversation data?
```

**Why**: Privacy is a feature - should understand implications.

---

## 8. TRADING BOT INTEGRATION

### Query 20: Trading Bot API Design
```
Best practices for Python trading bot to expose API to Electron desktop app?
File-based communication (reading/writing JSON)?
HTTP server in bot?
WebSocket for real-time updates?
Security for local inter-process communication?
```

**Why**: Nova needs to monitor and control separate trading bot.

---

### Query 21: Real-time Stock Data
```
Best free/cheap stock data APIs for personal trading assistant:
Interactive Brokers Python API?
Polygon.io?
Twelve Data?
Yahoo Finance?
Real-time vs delayed data?
```

**Why**: Need cost-effective way to get stock prices for alerts.

---

## 9. ADVANCED FEATURES

### Query 22: MediaPipe Hand Tracking
```
MediaPipe Hands for hand gesture control in Electron app:
Can it run on RTX 3060 in real-time?
Accuracy for gestures (open palm, pointing, etc)?
Latency?
Integration with Three.js for particle control?
```

**Why**: Optional feature - hand control of particles would be cool.

---

### Query 23: Vision Capabilities
```
Adding vision/screenshot analysis to Nova:
Best open-source vision model for laptops?
Can I run it on RTX 3060?
Speed vs quality tradeoff?
```

**Why**: Future feature - "Nova, what's on my screen?"

---

## 10. DEPLOYMENT & BUILD

### Query 24: Electron Auto-Update
```
Electron-builder auto-updater best practices 2025:
GitHub releases vs other hosting?
Staging rollouts?
Rollback mechanism?
Delta updates to save bandwidth?
```

**Why**: Need robust update mechanism for production.

---

### Query 25: Code Signing & Installer
```
Code signing Windows .exe for desktop app distribution:
Self-signed vs purchased certificate?
SmartScreen warnings?
Installer best practices?
```

**Why**: Don't want users getting security warnings.

---

## RESEARCH EXECUTION PLAN

**Recommended order** (prioritize by impact):

### Week 1 (Critical for Phase 1)
- [ ] Query 1 (Wake word)
- [ ] Query 2 (Deepgram)
- [ ] Query 3 (ElevenLabs voice)
- [ ] Query 11 (LLM provider)

### Week 2 (Critical for Phase 2)
- [ ] Query 14 (Orb performance)
- [ ] Query 15 (Attractors)
- [ ] Query 9 (Playwright)

### Week 3+ (Nice to have)
- [ ] Remaining queries based on priorities

---

## HOW TO USE THESE QUERIES

1. **Copy a query** to Perplexity
2. **Save the response** (bookmark or screenshot)
3. **Reference in implementation** when making architecture decisions
4. **Update plan** if findings contradict assumptions

---

## EXAMPLE RESEARCH OUTPUT TEMPLATE

When you research Query 1 (Wake word), document findings like:

```
QUERY: Best wake word detection for "Hey Nova"
SOURCE: Perplexity research
DATE: Jan 13, 2026

KEY FINDINGS:
- Porcupine: Best accuracy (94%+), $9.99/mo, easy custom words
- Vosk: Open-source alternative, ~80% accuracy, no custom training
- Snowboy: Deprecated, don't use

DECISION:
→ Use Porcupine for Phase 1 (best accuracy)
→ Evaluate Vosk as future fallback (open-source)
→ Custom model training possible but overkill initially

COST: $9.99/month production tier
EFFORT: 3-4 hours integration
```

---

## WHAT TO DO AFTER RESEARCH

1. **Update NOVA_REBUILD_PLAN.md** with findings
2. **Create GitHub issues** for decisions
3. **Link research results** in issue descriptions
4. **Share findings** in project wiki

---

**Remember**: These queries are research tools, not final answers. Use results to inform architectural decisions, not replace engineering judgment.

**Ready to research? Pick Query 1 and start building!**
