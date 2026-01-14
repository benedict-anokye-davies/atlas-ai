# 👋 Start Here - Nova Project Coordinator Guide

## What You Have Right Now

You just received a **fully implemented audio-reactive strange attractor visualization system** from Claude Code Agent. The particle orb is alive and beautiful! ✨

**Phase 1 Status:** ✅ **COMPLETE**

---

## 📁 Important Files (Read These First)

### Must Read (5 min)
1. **`SESSIONS.md`** - Active sessions and coordination log
2. **`COORDINATOR_QUICK_REFERENCE.md`** - Your daily reference (this file's companion)

### Should Read (15 min)
3. **`NOVA_MASTER_PLAN.md`** - Complete roadmap (6 phases, 38 sessions)
4. **`PHASE_2_ROADMAP.md`** - Week 1 detailed plan
5. **`ATTRACTOR_QUICK_START.md`** - Quick test guide

### Deep Dive (30 min)
6. **`docs/AUDIO_REACTIVE_ATTRACTORS.md`** - Full technical documentation
7. **`docs/ARCHITECTURE.md`** - System architecture

---

## 🎯 Your Mission

Transform Nova from a beautiful demo into a **fully functional voice AI assistant with personality**.

### Current State
```
✅ Particle orb visualization (5 attractors)
✅ Smooth state morphing
✅ Audio-reactive shaders
✅ Basic voice pipeline (wake word, STT, LLM, TTS)

⚠️ Audio is simulated (not connected to real TTS)
⚠️ No personality (generic AI responses)
⚠️ No memory (forgets previous conversations)
⚠️ Limited UI features
```

### End Goal (After Phase 5 - Week 4)
```
✅ Real audio-reactive orb (pulses with Nova's voice)
✅ Warm, consistent AI personality
✅ Conversation memory (remembers context)
✅ Advanced features (skills, vision, integrations)
✅ Production-ready release
✅ Complete documentation
```

---

## 🚀 Next Steps (Start Here!)

### Step 1: Test What You Have (10 min)

```bash
# Run the app
npm run dev

# In another terminal, run tests
npm run test
npm run typecheck
```

**Expected:** App opens, orb displays, can say "Hey Nova"

### Step 2: Understand the Orb (5 min)

Try triggering different states:
- Say **"Hey Nova"** → Orb morphs to **Thomas** (green, compact)
- AI processes → Orb morphs to **Aizawa** (purple, swirling)
- AI responds → Orb morphs to **Halvorsen** (gold, pulsing)
- Returns idle → Orb morphs to **Lorenz** (cyan, butterfly)

**Note:** Audio reactivity is simulated. That's what Terminal 1 will fix!

### Step 3: Assign First Tasks (Now!)

Open `SESSIONS.md` and assign sessions 027, 028, 029 to your terminals.

#### For Terminal 1:
```
Task: Session 027 - Real Audio Integration
Duration: 4-6 hours
Goal: Connect TTS audio to Web Audio API
Files: tts/manager.ts, App.tsx, types/index.ts
See: SESSIONS.md line 196-352
```

#### For Terminal 2:
```
Task: Session 028 - AI Personality System
Duration: 6-8 hours
Goal: Give Nova a warm, engaging personality
Files: personality.ts (new), personality-manager.ts (new), llm/manager.ts
See: SESSIONS.md line 355-622
```

#### For Terminal 3:
```
Task: Session 029 - Voice Pipeline + Memory
Duration: 6-8 hours
Goal: Improve voice detection, add conversation memory
Files: wakeword/manager.ts (new), memory/conversation-memory.ts (new), stt/manager.ts
See: SESSIONS.md line 625-860
```

**These can run in parallel!** They have no dependencies on each other.

---

## 📋 Coordination Workflow

### Daily Standup (5 min)
1. Check `SESSIONS.md` active sessions table
2. Review progress from previous day
3. Identify blockers
4. Adjust assignments if needed

### Mid-Session Check (15 min)
1. Pull latest changes: `git pull`
2. Run tests: `npm run test`
3. Check for conflicts
4. Update `SESSIONS.md` with progress notes

### End of Day (10 min)
1. Ensure all active sessions updated in `SESSIONS.md`
2. All work committed with clear messages
3. Tests passing
4. Document any issues for tomorrow

---

## 🎓 Understanding the Codebase

### Directory Structure
```
nova-desktop/
├── src/
│   ├── main/               # Electron main process
│   │   ├── agent/          # (CREATE) AI personality, skills
│   │   ├── llm/            # LLM integration (Fireworks AI)
│   │   ├── tts/            # Text-to-speech (ElevenLabs + Offline)
│   │   ├── stt/            # Speech-to-text (Deepgram + Vosk)
│   │   ├── memory/         # (CREATE) Conversation memory
│   │   ├── wakeword/       # (CREATE) Wake word detection
│   │   └── ipc/            # IPC handlers
│   │
│   ├── renderer/           # React app (UI)
│   │   ├── components/
│   │   │   ├── orb/        # ⭐ Particle orb (PHASE 1 COMPLETE)
│   │   │   │   ├── NovaOrbAttractor.tsx      # New attractor orb
│   │   │   │   ├── NovaParticles_Attractors.tsx  # Morphing system
│   │   │   │   ├── attractors.ts             # 5 attractor equations
│   │   │   │   ├── geometry.ts               # Point generation + morphing
│   │   │   │   └── shaders.ts                # Audio-reactive shaders
│   │   │   └── Settings.tsx  # Settings UI
│   │   ├── hooks/
│   │   │   ├── useNovaState.ts       # Main state hook
│   │   │   └── useAudioAnalysis.ts   # ⭐ Web Audio API (NEW)
│   │   └── stores/          # Zustand state management
│   │
│   └── shared/             # Shared types
│       └── types/          # TypeScript definitions
│
├── docs/                   # Documentation
│   ├── AUDIO_REACTIVE_ATTRACTORS.md  # ⭐ Orb guide
│   └── ARCHITECTURE.md     # System design
│
├── tests/                  # Test files
│
├── SESSIONS.md             # ⭐ COORDINATION HUB
├── NOVA_MASTER_PLAN.md     # ⭐ Complete roadmap
└── package.json            # Dependencies
```

**Key:** ⭐ = Critical files, (CREATE) = Need to create in Phase 2

---

## 🎨 Phase Breakdown (Quick View)

### Week 1: Core Features (Phase 2) 🟡 CURRENT
- Session 027: Real audio integration
- Session 028: Personality system
- Session 029: Voice pipeline + memory
- **Outcome:** Functional AI with personality

### Week 2: Advanced Features (Phase 3)
- Session 030: Enhanced UI/UX
- Session 031: Advanced conversation
- Session 032: Performance optimization
- **Outcome:** Polished, fast, feature-rich

### Week 3: Intelligence (Phase 4)
- Session 033: Knowledge base + skills
- Session 034: Multimodal (vision)
- Session 035: Platform integration
- **Outcome:** Smart AI with abilities

### Week 4: Production (Phase 5)
- Session 036: Testing & QA
- Session 037: Documentation
- Session 038: Release preparation
- **Outcome:** 🚀 Production release!

---

## 🔧 Common Coordinator Tasks

### Assigning a New Session
1. Open `SESSIONS.md`
2. Update active sessions table:
   ```markdown
   | 1 | session-027 | ACTIVE | Real Audio Integration | tts/* | 2026-01-14 17:00 |
   ```
3. Terminal sees task in their section
4. Terminal starts work

### Handling Blockers
1. Terminal reports blocker in `SESSIONS.md`
2. Coordinator investigates
3. Either:
   - Provide solution/guidance
   - Reassign task
   - Adjust dependencies
   - Create new mini-task

### Merging Completed Work
1. Terminal marks session COMPLETE in `SESSIONS.md`
2. Coordinator reviews changes
3. Run full test suite
4. Merge to main branch
5. Update progress metrics

### Adjusting Timeline
1. Review actual vs estimated time
2. Update `NOVA_MASTER_PLAN.md` if needed
3. Communicate changes to all terminals
4. Adjust future session estimates

---

## 📊 Progress Tracking

### Quick Status Check
```bash
# See git activity
git log --oneline --graph --all --since="1 week ago"

# Check test coverage
npm run test:coverage

# Count completed tasks
grep "COMPLETE" SESSIONS.md | wc -l
```

### Metrics Dashboard (Manual)
Update these weekly in `SESSIONS.md`:

```markdown
## PROJECT METRICS (Week 1)

Progress: 20% → 30% (Phase 1 → Phase 2 in progress)
Completed Sessions: 4 → 7
Test Coverage: 75% → 80%
Performance: 60 FPS stable
Memory Usage: ~450MB average
```

---

## 🚨 Red Flags (Watch For These)

| Red Flag | Action |
|----------|--------|
| Tests failing >2 days | STOP all work, fix tests |
| TypeScript errors accumulating | Mandatory typecheck before commits |
| Memory usage >800MB | Performance audit needed |
| Session taking 2x estimated time | Reassess scope, maybe split task |
| >3 sessions blocked | Urgent coordinator intervention |
| No commits for 24 hours | Check on terminal |

---

## 🎁 Quick Wins (Morale Boosters)

Between major sessions, assign small wins:
- Add a new attractor (30 min)
- Create a color theme (1 hour)
- Add keyboard shortcut (30 min)
- Write one test file (1 hour)
- Fix small UI bug (1 hour)

These keep momentum up during long sessions!

---

## 📞 Getting Help

### For Technical Questions
1. Check `docs/AUDIO_REACTIVE_ATTRACTORS.md`
2. Check `NOVA_MASTER_PLAN.md`
3. Search codebase for examples
4. Ask in terminal's session notes

### For Planning Questions
1. Check `COORDINATOR_QUICK_REFERENCE.md`
2. Review `PHASE_2_ROADMAP.md`
3. Update `SESSIONS.md` with question
4. Adjust plan as needed

### For Emergencies
1. Create GitHub issue with `[BLOCKER]` tag
2. Update `SESSIONS.md` with details
3. Pause dependent sessions
4. Coordinator investigates immediately

---

## 🎯 Success Metrics

### Phase 2 Complete When:
- ✅ All 3 sessions done (027, 028, 029)
- ✅ Tests pass
- ✅ Real audio working
- ✅ Personality consistent
- ✅ Memory functional
- ✅ No critical bugs

### Overall Project Success:
- ✅ All 5 phases complete
- ✅ >85% test coverage
- ✅ Production builds for Windows/Mac/Linux
- ✅ Documentation complete
- ✅ Demo video recorded
- ✅ **Nova is alive and amazing!** 🎉

---

## 🚀 Let's Build This!

You have everything you need:
- ✅ Beautiful orb visualization (Phase 1 done)
- ✅ Complete roadmap (38 sessions planned)
- ✅ Detailed instructions (SESSIONS.md)
- ✅ Reference guides (multiple docs)
- ✅ Clean codebase (TypeScript + tests)

**Next action:** Assign sessions 027, 028, 029 to your terminals and start Phase 2!

---

**Questions?** Check the docs first, then update `SESSIONS.md`

**Ready?** Open `SESSIONS.md` and start coordinating! 🎯

**Excited?** You should be - you're building something amazing! ✨

---

**Created by:** Claude Code Agent (session-026)
**Date:** 2026-01-14
**Phase:** 1 complete, Phase 2 ready
**Status:** 🟢 All systems go!

---

## TL;DR (Too Long; Didn't Read)

1. Run `npm run dev` to test the orb ✅
2. Read `SESSIONS.md` (coordination hub) 📋
3. Assign sessions 027, 028, 029 to terminals 👥
4. Terminals start working (can run in parallel) 🔨
5. Check progress daily, update `SESSIONS.md` 📊
6. Phase 2 done = Nova has personality + real audio + memory 🎉
7. Continue through phases 3-5 over 3 more weeks 📅
8. Ship production release! 🚀

**You got this!** 💪
