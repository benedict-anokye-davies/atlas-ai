# Nova Project - Complete Documentation Index

**All planning documents created for your Nova Desktop AI Assistant project.**  
**Status**: Ready to start development  
**Current Date**: January 13, 2026, 3:38 AM GMT

---

## 📚 DOCUMENTATION HIERARCHY

### FOUNDATION DOCUMENTS (Start Here)

#### 1. **NOVA_REBUILD_PLAN.md** (2000+ lines)
**What it is**: Complete architectural blueprint for Nova  
**Read this when**: You need the full technical vision  
**Key sections**:
- Executive summary & hardware specs
- Detailed 4-phase architecture (Voice → Orb → Agent → Memory)
- Complete TypeScript code implementations
- API configuration & cost breakdown
- Deployment checklist

**Use for**: Understanding the overall system design

---

#### 2. **NOVA_PHASE1_WEEK_BY_WEEK.md** (Implementation schedule)
**What it is**: Day-by-day breakdown of exactly what to code  
**Read this when**: You're ready to start Day 1  
**Key sections**:
- Week 1 (5 days): Setup → Voice detection → STT → LLM → TTS
- Week 2 (3 days): Polish → Minimal UI → Testing
- Each day has: Time estimates, exact tasks, code snippets, success criteria

**Use for**: Your daily implementation roadmap. Do exactly what it says.

---

#### 3. **NOVA_GITHUB_STARTER.md** (Project boilerplate)
**What it is**: Ready-to-use project structure  
**Read this when**: Setting up your GitHub repo  
**Key sections**:
- Directory structure template
- Package.json configuration
- Key files to implement (prioritized by phase)
- Development workflow

**Use for**: `git clone` and follow the structure exactly

---

### RESEARCH DOCUMENTS

#### 4. **NOVA_PERPLEXITY_RESEARCH.md** (25 research queries)
**What it is**: Questions to research on Perplexity.ai  
**Read this when**: You need to validate technical choices  
**Key sections**:
- 10 categories of research questions
- Voice & audio (5 queries)
- Memory & persistence (3 queries)
- Browser automation (2 queries)
- LLM selection (3 queries)
- Visual orb (2 queries)
- And more...

**Each query includes**:
- Exact question to paste into Perplexity
- Why this research matters
- How to use the findings

**Use for**: Fill knowledge gaps, validate assumptions. Pick 1-2 queries per day.

---

#### 5. **NOVA_ML_STRATEGY.md** (Advanced techniques roadmap)
**What it is**: Roadmap for adding ML enhancements after MVP  
**Read this when**: Phase 4 is complete (Week 13+)  
**Key sections**:
- Why Fireworks AI (don't use local LLMs yet) ✅
- Phase 5-6 enhancements: HyDE, temporal weighting, Silero VAD
- Phase 7-8 intelligence: Reflexion, DPO fine-tuning
- Phase 9+ advanced: GraphRAG, Tree of Thoughts
- Cost-benefit analysis for each technique

**Use for**: Strategic planning for post-MVP enhancements

---

## 🎯 HOW TO USE THESE DOCUMENTS

### Week 1 (Jan 13-19): Planning & Setup
1. **Read**: NOVA_REBUILD_PLAN.md (understand vision)
2. **Read**: NOVA_PHASE1_WEEK_BY_WEEK.md (understand schedule)
3. **Follow**: NOVA_GITHUB_STARTER.md (create repo structure)
4. **Research**: NOVA_PERPLEXITY_RESEARCH.md (Query 1: Wake word detection)
5. **Skip**: NOVA_ML_STRATEGY.md (for Week 10)

### Week 2-3 (Jan 20-Feb 2): Implementation
1. **Follow**: NOVA_PHASE1_WEEK_BY_WEEK.md day-by-day
2. **Reference**: NOVA_REBUILD_PLAN.md for code snippets
3. **Use**: NOVA_PERPLEXITY_RESEARCH.md when stuck on decisions
4. **Ignore**: NOVA_ML_STRATEGY.md (focus on MVP)

### Week 4+ (Feb 3+): Enhancement
1. **Reference**: NOVA_REBUILD_PLAN.md for Phase 2 (Visual Orb)
2. **Read**: NOVA_ML_STRATEGY.md at Week 10 for HyDE + temporal weighting
3. **Use**: NOVA_PERPLEXITY_RESEARCH.md for any new unknowns

---

## 📋 WHAT EACH DOCUMENT ANSWERS

| Question | Document | Section |
|----------|----------|---------|
| "What am I building?" | NOVA_REBUILD_PLAN.md | Executive Summary |
| "How do I build it?" | NOVA_PHASE1_WEEK_BY_WEEK.md | Day-by-day breakdown |
| "What's the code structure?" | NOVA_GITHUB_STARTER.md | Project Structure |
| "What should I research?" | NOVA_PERPLEXITY_RESEARCH.md | All 25 queries |
| "How do I add ML techniques?" | NOVA_ML_STRATEGY.md | Phase 5-8 roadmap |
| "How much will it cost?" | NOVA_REBUILD_PLAN.md | API Configuration |
| "How long will it take?" | NOVA_REBUILD_PLAN.md | Estimated Timeline |
| "What if X breaks?" | NOVA_PHASE1_WEEK_BY_WEEK.md | Contingency Plans |

---

## 🔑 KEY DECISIONS LOCKED IN

These decisions have been researched and validated. **Don't second-guess**:

| Component | Choice | Why |
|-----------|--------|-----|
| **Framework** | Electron + React | Desktop app, full Node access |
| **Primary LLM** | Fireworks (DeepSeek R1 32B) | Fast, cheap, good for voice |
| **LLM Fallback** | OpenRouter (Claude 3.5) | When Fireworks rate-limited |
| **Local Model** | None initially (add Week 17+) | Complexity not worth it now |
| **Wake Word** | Porcupine | Best accuracy for custom words |
| **STT** | Deepgram Nova-3 | Real-time, accurate, cheap |
| **TTS** | ElevenLabs (Onyx voice) | Natural, streaming, quality |
| **Visual** | React Three Fiber (Aizawa) | Performant, beautiful |
| **Memory** | Mem0 + LanceDB | Permanent, semantic, local |
| **Research** | Autonomous (node-cron) | Runs idle, finds opportunities |

**Don't change these unless research proves them wrong.**

---

## ⏱️ TIMELINE AT A GLANCE

| Phase | Duration | Cumulative | Status |
|-------|----------|------------|--------|
| Phase 1: Voice | 2 weeks | Week 2 | START HERE (Jan 13-27) |
| Phase 2: Orb | 2 weeks | Week 4 | After exams (Jan 28-Feb 10) |
| Phase 3: Agent + Tools | 2-3 weeks | Week 7 | (Feb 11-Mar 3) |
| Phase 4: Memory | 2 weeks | Week 9 | (Mar 4-17) |
| Phase 5: Research | 2 weeks | Week 11 | (Mar 18-31) |
| Phase 6: Desktop UI | 1 week | Week 12 | (Apr 1-7) |
| Phase 7: Lecture Notes | 1 week | Week 13 | (Apr 8-14) |
| **MVP Complete** | 13 weeks | | ~April 14, 2026 |
| Phase 8: Trading Bot | 2 weeks | Week 15 | (Apr 15-28) |
| Phase 9: Self-Improve | Ongoing | | (May+) |

---

## 🎓 BEFORE YOU START

**Checklist**:
- [ ] Read NOVA_REBUILD_PLAN.md (Executive Summary section only - 10 min)
- [ ] Read NOVA_PHASE1_WEEK_BY_WEEK.md (Days 1-3 - 20 min)
- [ ] Get API keys:
  - [ ] Porcupine (picovoice.ai) - free
  - [ ] Deepgram (deepgram.com) - free tier
  - [ ] ElevenLabs (elevenlabs.io) - free tier
  - [ ] Anthropic (console.anthropic.com) - $5 starter
- [ ] Verify Node.js installed: `node --version`
- [ ] Create GitHub account (if needed)
- [ ] Have 4-5 hours free for Day 1

---

## 🚀 YOUR NEXT 3 ACTIONS

### Action 1 (Today, Jan 13)
**Read NOVA_PHASE1_WEEK_BY_WEEK.md**
- Focus on: Days 1-2 overview
- Time: 20 minutes
- Result: Understand what you're building next

### Action 2 (Today, Jan 13)
**Get 4 API keys**
- Porcupine (5 min)
- Deepgram (5 min)
- ElevenLabs (5 min)
- Anthropic (5 min)
- Total: 20 minutes
- Result: Ready to code

### Action 3 (Tomorrow, Jan 14)
**Start Day 1 of Phase 1**
- Create GitHub repo
- Initialize Node.js project
- Install Electron + React
- Time: 3-4 hours
- Result: Blank Electron window running

---

## 📞 IF YOU GET STUCK

**Step 1**: Check the relevant document section  
**Step 2**: Use Perplexity research queries  
**Step 3**: Try contingency plan in NOVA_PHASE1_WEEK_BY_WEEK.md  
**Step 4**: Move to next day, come back later

**Most common issues**:
- "This API key isn't working" → Double-check .env file formatting
- "Electron won't start" → Check Node.js version, reinstall node_modules
- "Microphone not detected" → Use different input device in OS settings
- "Rate limited" → Use OpenRouter fallback (documented in plan)

---

## 🎬 THE MASTER PLAN

```
WEEK 1 (Now): Planning + Setup
├─ Read docs
├─ Get API keys
└─ Day 1: Create project

WEEKS 2-3: Voice Pipeline MVP
├─ Wake word detection (Porcupine)
├─ Speech recognition (Deepgram)
├─ LLM response (Fireworks)
└─ Text-to-speech (ElevenLabs)
RESULT: "Hey Nova" works!

WEEKS 4-6 (Post-exams): Visual Orb
├─ React Three Fiber setup
├─ Aizawa attractor math
├─ State-based colors
└─ Smooth animations
RESULT: Beautiful particle orb!

WEEKS 7-9: Core Agent
├─ File system access
├─ Browser automation (Playwright)
├─ Git operations
└─ Web search
RESULT: Nova can actually do things!

WEEKS 10-13: Memory System
├─ Mem0 + LanceDB
├─ Conversation storage
├─ Memory recall
└─ Preference learning
RESULT: Nova remembers everything!

WEEKS 14-15: Autonomous Research
├─ Background research scheduler
├─ Notification badges
└─ Sorting/categorization
RESULT: Nova researches while you sleep!

WEEK 16+: Enhancement & Scale
├─ HyDE retrieval
├─ Temporal weighting
├─ Reflexion learning
└─ DPO fine-tuning
RESULT: Nova is smarter and personalized!
```

**Total: ~6 months to full feature-complete MVP**  
**Baseline MVP: 3 weeks to working voice assistant**

---

## 💡 REMEMBER

1. **Start with Fireworks AI** (don't add local models yet) ✅
2. **Focus on Phase 1** (voice pipeline) first
3. **One phase at a time** (don't jump ahead)
4. **Research as you go** (Perplexity queries)
5. **Test continuously** (don't build in isolation)
6. **Add ML techniques later** (after MVP works)

---

## 📖 DOCUMENT VERSIONS

| Document | Version | Status | Last Updated |
|----------|---------|--------|--------------|
| NOVA_REBUILD_PLAN.md | 2.0 | Complete | Jan 13, 2026 |
| NOVA_PHASE1_WEEK_BY_WEEK.md | 1.0 | Complete | Jan 13, 2026 |
| NOVA_GITHUB_STARTER.md | 1.0 | Complete | Jan 13, 2026 |
| NOVA_PERPLEXITY_RESEARCH.md | 1.0 | Complete | Jan 13, 2026 |
| NOVA_ML_STRATEGY.md | 1.0 | Complete | Jan 13, 2026 |

All documents synchronized, cross-referenced, and ready for implementation.

---

## 🏆 SUCCESS CRITERIA

**Phase 1 Complete (Jan 27)**:
```
You say: "Hey Nova, tell me a joke"
Nova says: (laughs) "Why did the AI go to school? 
            To improve its learning models!"
```

That's MVP. Everything else is bonus.

---

**You have all the information you need.**  
**You have the timeline.**  
**You have the contingency plans.**  

**Time to build. 🚀**

---

## QUICK REFERENCE

**Want the TL;DR?**
1. Read: NOVA_PHASE1_WEEK_BY_WEEK.md (20 min)
2. Do: Day 1 tasks (3-4 hours)
3. Come back to NOVA_REBUILD_PLAN.md when implementing

**Want deep dives?**
1. Start: NOVA_REBUILD_PLAN.md (full system)
2. Then: NOVA_ML_STRATEGY.md (future enhancements)
3. Reference: NOVA_PERPLEXITY_RESEARCH.md (validate choices)

**Want to start coding now?**
1. Clone: NOVA_GITHUB_STARTER.md directory structure
2. Follow: NOVA_PHASE1_WEEK_BY_WEEK.md Day 1
3. Reference: NOVA_REBUILD_PLAN.md code snippets

---

**All 5 documents complete and cross-linked.**  
**Ready to build Nova? Let's go!** 🎯
