# Nova Coordinator - Quick Reference Card

## 🎯 Current Status (Phase 1 Complete)

### ✅ What's Working Now
- Beautiful 3D particle orb with 5 strange attractors
- Smooth morphing between AI states (idle/listening/thinking/speaking/error)
- Audio-reactive shaders (simulated for now)
- Basic voice pipeline (wake word + STT + LLM + TTS)
- Electron app with React + TypeScript + Three.js

### ⚠️ What's Missing
- Real audio integration (orb uses simulated audio)
- AI personality (generic LLM responses)
- Conversation memory (can't remember previous chats)
- Advanced UI features (limited settings)

---

## 📋 Immediate Next Tasks (Phase 2 - Week 1)

### Terminal 1 - Session 027: Real Audio Integration 🔊
**When to assign:** Now
**Duration:** 4-6 hours
**Goal:** Make orb react to real TTS audio output

**Quick Checklist:**
- [ ] Stream TTS audio from main process to renderer via IPC
- [ ] Add `<audio>` element in App.tsx
- [ ] Connect `useAudioAnalysis` hook to audio element
- [ ] Test with ElevenLabs TTS
- [ ] Test with offline TTS fallback
- [ ] Verify bass/treble/pulse extraction works

**Files to modify:**
- `src/main/tts/manager.ts`
- `src/renderer/App.tsx`
- `src/shared/types/index.ts`

**Success:** Orb pulses with real speech, not simulated

---

### Terminal 2 - Session 028: AI Personality System 🤖
**When to assign:** Now (can run parallel with Terminal 1)
**Duration:** 6-8 hours
**Goal:** Give Nova a consistent, warm, engaging personality

**Quick Checklist:**
- [ ] Create personality type definitions
- [ ] Build personality manager class
- [ ] Define Nova's personality traits (friendliness: 0.9, humor: 0.7, etc.)
- [ ] Integrate with LLM system prompts
- [ ] Add personality sliders to Settings UI
- [ ] Test personality consistency across conversations

**Files to create:**
- `src/shared/types/personality.ts`
- `src/main/agent/personality-manager.ts`

**Files to modify:**
- `src/main/llm/manager.ts`
- `src/renderer/components/Settings.tsx`
- `src/renderer/stores/index.ts`

**Success:** Nova feels alive, warm, and consistent

---

### Terminal 3 - Session 029: Voice Pipeline + Memory 🎙️
**When to assign:** Now (can run parallel with Terminal 1&2)
**Duration:** 6-8 hours
**Goal:** Improve voice detection and add conversation memory

**Quick Checklist:**
- [ ] Enhance wake word detection (confidence threshold)
- [ ] Add adaptive VAD (longer timeout for complex questions)
- [ ] Create conversation memory system (last 50 turns)
- [ ] Add user preferences storage
- [ ] Integrate memory into LLM context
- [ ] Add conversation stats to Settings UI

**Files to create:**
- `src/main/wakeword/manager.ts`
- `src/main/memory/conversation-memory.ts`

**Files to modify:**
- `src/main/stt/manager.ts`
- `src/main/llm/manager.ts`
- `src/renderer/components/Settings.tsx`

**Success:** Nova remembers context, wake word >95% accurate

---

## 🗺️ Long-Term Roadmap

| Phase | Duration | Focus | Status |
|-------|----------|-------|--------|
| **Phase 1** | 2-3 hours | Audio-Reactive Attractors | ✅ COMPLETE |
| **Phase 2** | 16-22 hours | Core Features (Audio + Personality + Memory) | 🟡 IN PROGRESS |
| **Phase 3** | 22-28 hours | Advanced UI + Conversation + Performance | ⏳ WEEK 2 |
| **Phase 4** | 28-34 hours | Intelligence (Skills + Vision + Integration) | ⏳ WEEK 3 |
| **Phase 5** | 28-35 hours | Production (Testing + Docs + Release) | ⏳ WEEK 4 |
| **Phase 6** | Variable | Post-Launch Features | ⏳ FUTURE |

**Total Time:** ~3-4 weeks of development
**Total Sessions:** 38 planned sessions

---

## 📊 Session Management Protocol

### Before Starting a Session

1. **Check SESSIONS.md** - Read active sessions table
2. **Update Status** - Mark your session as ACTIVE
3. **Lock Files** - List files you'll modify
4. **Read Dependencies** - Check if other sessions need to complete first

Example:
```markdown
| 1 | session-027 | ACTIVE | Real Audio Integration | tts/*, App.tsx | 2026-01-14 17:00 UTC |
```

### During the Session

1. **Commit Often** - Small, clear commits
2. **Update Progress** - Add notes to SESSIONS.md as you go
3. **Test Incrementally** - Don't wait until the end
4. **Ask for Help** - Post in coordinator terminal if blocked

### After Completing a Session

1. **Run Tests** - `npm run test && npm run typecheck`
2. **Update SESSIONS.md** - Mark COMPLETE, unlock files
3. **Document Issues** - Note any problems found
4. **Create Handoff** - Write summary for dependent sessions

Example:
```markdown
| 1 | session-027 | COMPLETE | Real Audio Integration | (none) | 2026-01-14 20:30 UTC |

Session 027 Notes:
- Real audio streaming works via IPC
- Audio element in App.tsx connected to useAudioAnalysis
- Tested with both ElevenLabs and offline TTS
- Known issue: Small audio delay (~50ms) - acceptable
- Next session can proceed
```

---

## 🎯 Quality Checkpoints

### After Phase 2 (Week 1)
- [ ] Orb reacts to real TTS audio
- [ ] Nova has consistent personality
- [ ] Memory works across sessions
- [ ] All tests pass
- [ ] No TypeScript errors

### After Phase 3 (Week 2)
- [ ] UI responsive and polished
- [ ] Conversation history works
- [ ] Performance optimized (60fps)
- [ ] Accessibility features added

### After Phase 4 (Week 3)
- [ ] 7 skills working
- [ ] Image analysis functional
- [ ] System tray integrated
- [ ] Auto-updates work

### After Phase 5 (Week 4)
- [ ] >85% test coverage
- [ ] Complete documentation
- [ ] Release packages built
- [ ] Demo video recorded
- [ ] **🚀 PRODUCTION READY**

---

## 🚨 Common Issues & Solutions

### Issue: TypeScript Errors After Changes
**Solution:** Run `npm run typecheck` and fix before committing

### Issue: Tests Failing
**Solution:** Fix tests immediately - don't accumulate technical debt

### Issue: Performance Drop
**Solution:** Check particle count in settings, reduce if needed

### Issue: Audio Not Streaming
**Solution:** Verify IPC channel registration in main/ipc/handlers.ts

### Issue: Attractor Not Morphing
**Solution:** Check state prop is changing (React DevTools)

### Issue: Memory Leak
**Solution:** Ensure cleanup in useEffect hooks, check Three.js disposal

---

## 📞 Communication Channels

### For Coordinators
- Update `SESSIONS.md` for all session changes
- Create GitHub issues for bugs
- Use commit messages to document decisions

### For Terminal Workers
- Read SESSIONS.md before starting
- Comment in code for complex logic
- Write tests for new features
- Document APIs you create

---

## 🎓 Key Resources

| Resource | Purpose | Location |
|----------|---------|----------|
| Master Plan | Complete phase breakdown | `NOVA_MASTER_PLAN.md` |
| Session Log | Active/completed sessions | `SESSIONS.md` |
| Architecture | System overview | `docs/ARCHITECTURE.md` |
| Attractor Guide | Orb visualization | `docs/AUDIO_REACTIVE_ATTRACTORS.md` |
| Quick Start | Getting started | `ATTRACTOR_QUICK_START.md` |
| Phase 2 Roadmap | Current phase details | `PHASE_2_ROADMAP.md` |

---

## 📈 Progress Tracking

### Phase Completion Formula
```
Phase Progress = (Completed Sessions / Total Sessions) × 100%

Phase 2 Progress = (0 / 3) × 100% = 0%
  - Session 027: READY
  - Session 028: READY
  - Session 029: READY
```

### Overall Project Progress
```
Total Progress = (Completed Phases / Total Phases) × 100%

Current: (1 / 5) × 100% = 20% Complete
```

---

## 🎁 Quick Wins (If Ahead of Schedule)

1. **Add Easter Eggs** - Fun hidden features
2. **Create Themes** - Color variations
3. **Add Shortcuts** - Keyboard commands
4. **Improve Onboarding** - Welcome tutorial
5. **Add Metrics** - Usage analytics

---

## 🔧 Development Commands

```bash
# Start development
npm run dev

# Run tests
npm run test

# Type checking
npm run typecheck

# Build for production
npm run build

# Lint and format
npm run lint && npm run format

# Check test coverage
npm run test:coverage
```

---

## 🎯 Definition of Done

A session is COMPLETE when:
- ✅ All checklist items finished
- ✅ Tests pass (`npm run test`)
- ✅ TypeScript compiles (`npm run typecheck`)
- ✅ Code formatted (`npm run format`)
- ✅ Documented in code comments
- ✅ SESSIONS.md updated
- ✅ No known critical bugs

---

**Coordinator:** Claude Code Agent
**Last Updated:** 2026-01-14 17:00 UTC
**Current Phase:** Phase 2 (Week 1)
**Next Milestone:** Phase 2 Complete (ETA: Week 1 end)

---

## 🚦 Status Indicators

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🟡 | In Progress |
| ⏳ | Pending/Scheduled |
| 🔴 | Blocked |
| ⚠️ | Issue/Warning |
| 🎉 | Milestone Reached |
