# Nova Orchestrator System

## Overview

This document defines how AI agents (including sub-agents) should work on Nova.

The system uses a **hierarchical orchestration pattern**:

```
┌─────────────────────────────────────────────────────────┐
│                   MAIN ORCHESTRATOR                      │
│  (OpenCode/Claude - reads PRD, assigns tasks)           │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Worker  │   │ Worker  │   │ Worker  │
   │ Agent 1 │   │ Agent 2 │   │ Agent 3 │
   │ (Setup) │   │ (Audio) │   │ (LLM)   │
   └─────────┘   └─────────┘   └─────────┘
```

---

## How It Works

### 1. Orchestrator (Main Agent)
- Reads PRD.md and progress.txt
- Identifies next task(s) to work on
- Spawns sub-agents for parallel work (when possible)
- Reviews completed work
- Updates progress and commits

### 2. Worker Agents (Sub-Agents)
- Receive specific task assignment
- Implement the assigned feature
- Write tests for their code
- Return results to orchestrator

### 3. Research Agent (Optional)
- Uses Perplexity API for web research
- Gathers latest documentation
- Finds solutions to complex problems

---

## Task Assignment Rules

### Can Be Parallelized:
- Tasks with no dependencies
- Different modules (voice, LLM, TTS)
- Tests for completed features
- Documentation tasks

### Must Be Sequential:
- Project setup (Task 1) - must be first
- Tasks that depend on previous outputs
- Integration tasks
- Performance optimization (needs working features)

### Dependency Graph:
```
Task 1 (Setup) ─────────────────────────────────────────────┐
    │                                                        │
    ├─► Task 2 (Config) ──► Task 3 (Logging)                │
    │                           │                            │
    │   ┌───────────────────────┴───────────────────┐       │
    │   │                                           │       │
    │   ▼                                           ▼       │
    │   Task 4 (Error Handling)                             │
    │                                                        │
    ├─► Task 5 (Wake Word) ─► Task 6 (VAD) ─► Task 7 (Pipeline)
    │                                              │
    │   ┌──────────────────────────────────────────┤
    │   │                                          │
    │   ▼                                          ▼
    │   Task 8 (Deepgram) ──────────────────► Task 9 (Vosk Fallback)
    │                                              │
    ├─► Task 10 (Fireworks) ────────────────► Task 11 (OpenRouter)
    │                                              │
    ├─► Task 12 (ElevenLabs) ───────────────► Task 13 (Local TTS)
    │                                              │
    │   ┌──────────────────────────────────────────┘
    │   │
    │   ▼
    ├─► Task 14 (Tests) ──► Task 15 (Performance) ──► Task 16 (Docs)
    │
    └───────────────────────────────────────────────────────┘
```

---

## Orchestrator Prompts

### For Single Task (ralph.sh):
```
Read @PRD.md and @progress.txt

1. Find the NEXT incomplete task (marked [ ] Not Started)
2. Implement ALL sub-tasks for that task
3. Write tests for your implementation
4. Verify tests pass: npm run test
5. Update the task status to [x] Complete in PRD.md
6. Add summary to progress.txt
7. Commit: git commit -m "feat(phase1): task N - description"

STRICT RULES:
- ONE task per iteration
- ALL sub-tasks must be complete
- Tests MUST pass
- If blocked, document and skip to next task

Output: Summary of what was implemented
If ALL tasks complete: <COMPLETE/>
```

### For Parallel Tasks (advanced):
```
Read @PRD.md and @progress.txt

Identify tasks that can run in parallel:
- Task 5 (Wake Word) + Task 10 (LLM) - no dependencies
- Task 8 (STT) + Task 12 (TTS) - no dependencies

Spawn sub-agents for each parallel task.
Wait for all to complete.
Run integration tests.
Update progress.

Output: Summary of parallel work completed
```

---

## Quality Gates

Before marking ANY task complete:

### Gate 1: Code Quality
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] ESLint passes: `npm run lint`
- [ ] No console errors

### Gate 2: Testing
- [ ] Unit tests pass: `npm run test`
- [ ] Coverage > 80% for new code
- [ ] Integration works with existing code

### Gate 3: Performance
- [ ] No memory leaks
- [ ] Meets latency targets (see PRD)
- [ ] No blocking operations on main thread

### Gate 4: Documentation
- [ ] JSDoc comments on public APIs
- [ ] README updated if needed
- [ ] Complex logic explained

---

## Research Integration (Perplexity)

When an agent encounters:
- Unknown API behavior
- Complex implementation questions
- Best practices queries

Use Perplexity API:
```typescript
const response = await fetch('https://api.perplexity.ai/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama-3.1-sonar-large-128k-online',
    messages: [{
      role: 'user',
      content: 'How to implement Porcupine wake word in Node.js Electron app?'
    }]
  })
});
```

Research queries to run:
1. "Porcupine wake word Node.js Electron integration 2024"
2. "Deepgram Nova-3 streaming transcription TypeScript"
3. "ElevenLabs streaming TTS Node.js implementation"
4. "Fireworks AI DeepSeek R1 API TypeScript example"
5. "React Three Fiber particle system performance optimization"

---

## Error Recovery

### If Task Fails:
1. Log the error in progress.txt
2. Add blocker note in PRD.md
3. Attempt 1 retry with different approach
4. If still failing, skip to next task
5. Create GitHub issue for manual review

### If Tests Fail:
1. Read test output carefully
2. Fix the failing test or code
3. Re-run tests
4. If 3 attempts fail, document and continue

### If API Errors:
1. Check API key is valid
2. Check rate limits
3. Try fallback service
4. Document in blockers

---

## Commit Convention

Format: `type(scope): description`

Types:
- `feat` - New feature
- `fix` - Bug fix
- `test` - Tests
- `docs` - Documentation
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `chore` - Maintenance

Examples:
```
feat(phase1): task 1 - electron react typescript setup
feat(voice): implement porcupine wake word detection
fix(stt): handle deepgram connection timeout
test(llm): add unit tests for fireworks integration
docs: update README with setup instructions
```

---

## Progress Reporting

After each task, update progress.txt:

```markdown
### Task N: [Name] - COMPLETE ✓
**Time**: 15 min
**Files Changed**: 5
**Tests Added**: 3
**Notes**: Implemented X, Y, Z. Used approach A because...
**Commit**: abc1234
```

---

## Starting the Build

### Option 1: Interactive (Recommended for first run)
```bash
./ralph.sh
# Watch output, verify it works
./ralph.sh
# Continue until Phase 1 complete
```

### Option 2: Autonomous (Overnight)
```bash
./auto-build.sh 50 > build.log 2>&1 &
# Go to sleep
# Check in morning: tail -100 build.log
```

### Option 3: Parallel Phases (After Phase 1)
```bash
# Terminal 1
./auto-build.sh 30 # Continue Phase 1

# Terminal 2  
./auto-build-phase2.sh 30 # Start Phase 2 in parallel
```

---

## Success Criteria

Phase 1 is COMPLETE when:
- [ ] All 16 tasks marked [x] Complete
- [ ] All tests passing (80%+ coverage)
- [ ] App starts without errors
- [ ] "Hey Nova" triggers response
- [ ] Voice conversation works end-to-end
- [ ] Performance targets met
- [ ] README complete

---

## Next Steps After Phase 1

1. Review all commits: `git log --oneline`
2. Run full test suite: `npm run test:all`
3. Test manually: `npm run dev`
4. Create Phase 2 PRD (Visual Orb)
5. Continue autonomous building
