# Nova Multi-Session Coordination

## ACTIVE SESSIONS

| Terminal | Session ID | Status | Current Task | Files Locked | Last Updated |
|----------|------------|--------|--------------|--------------|--------------|
| 1 | session-001 | ACTIVE | Coordinator/Available | SESSION_CONTEXT.md, SESSIONS.md | 2026-01-13 05:35 UTC |
| 2 | - | OFFLINE | - | - | - |
| 3 | - | OFFLINE | - | - | - |

---

## HOW TO USE

### When Starting a New Session:

1. Read this file first: `cat SESSIONS.md`
2. Register your session by telling the AI:
   ```
   I am Terminal [N]. Register me in SESSIONS.md and read SESSION_CONTEXT.md.
   Pick an available task that doesn't conflict with other terminals.
   ```

3. The AI will:
   - Update this file with your terminal number
   - Lock the files it's working on
   - Start working on a non-conflicting task

### File Locking Rules:

- Each session locks files it's actively editing
- Check "Files Locked" column before editing
- If a file is locked, work on something else
- Release locks when task is complete

---

## TASK ASSIGNMENTS

### Available Tasks (not assigned):
- [ ] Task 4: Error Handling & Recovery
- [ ] Task 5: Wake Word Detection (Porcupine)
- [ ] Task 6: Voice Activity Detection (Silero VAD)
- [ ] Task 7: Audio Pipeline Manager
- [ ] Task 8: Speech-to-Text (Deepgram)
- [ ] Task 9: Offline STT Fallback (Vosk)
- [ ] Task 10: LLM Integration (Fireworks)
- [ ] Task 11: LLM Fallback (OpenRouter)
- [ ] Task 12: Text-to-Speech (ElevenLabs)
- [ ] Task 13: Offline TTS Fallback
- [ ] Task 14: Test Suite
- [ ] Task 15: Performance Optimization
- [ ] Task 16: Documentation

### In Progress:
(none currently)

### Completed:
- [x] Task 1: Project Setup (Terminal 1)
- [x] Task 2: Environment & Configuration (Terminal 1)
- [x] Task 3: Logging System (Terminal 1)

---

## COMMUNICATION LOG

Use this section to leave messages for other sessions:

```
[2026-01-13 05:35] Terminal 1: Completed Tasks 1-3. Foundation is ready. 
                               16 tests passing. Config and logging working.
                               Next terminal can start Task 4 or Task 5.
```

---

## CONFLICT PREVENTION

### Safe to Work in Parallel:
- Task 4 (Error Handling) - standalone utilities
- Task 10 (LLM) + Task 12 (TTS) - different modules
- Task 14 (Tests) - can run alongside any task

### Must Be Sequential:
- Task 5 → Task 6 → Task 7 (Audio pipeline depends on each)
- Task 8 → Task 9 (STT and its fallback)
- Task 10 → Task 11 (LLM and its fallback)
- Task 12 → Task 13 (TTS and its fallback)

### Shared Files (Coordinate Before Editing):
- `src/main/index.ts` - Main process, many tasks touch this
- `src/main/preload.ts` - IPC channels
- `package.json` - Dependencies
- `SESSION_CONTEXT.md` - Progress tracking

---

## SESSION COMMANDS

### Check Status:
```bash
cat SESSIONS.md | head -20
```

### Refresh Before Working:
```bash
git pull  # If using remote
cat SESSIONS.md
```

### After Completing a Task:
1. Update SESSIONS.md (release locks, update status)
2. Update SESSION_CONTEXT.md (mark task complete)
3. Commit changes
4. Leave a message in Communication Log

---

## EMERGENCY: Conflict Detected

If two sessions edited the same file:
1. Stop both sessions
2. Check `git status` and `git diff`
3. Manually resolve conflicts
4. One session continues, other picks different task
