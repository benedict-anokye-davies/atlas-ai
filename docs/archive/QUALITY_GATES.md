# Nova Quality Gates Checklist

## Before Starting Any Task

- [ ] Read PRD.md completely
- [ ] Check progress.txt for current state
- [ ] Identify dependencies (can this run in parallel?)
- [ ] Check .env has required API keys

---

## During Implementation

### Code Quality
- [ ] TypeScript strict mode enabled
- [ ] No `any` types (use proper typing)
- [ ] Functions have JSDoc comments
- [ ] Error handling with try/catch
- [ ] Proper logging with Winston

### Security
- [ ] No hardcoded secrets
- [ ] API keys from environment only
- [ ] Input validation on user data
- [ ] No eval() or similar

### Performance
- [ ] No blocking operations on main thread
- [ ] Async/await used properly
- [ ] Resources cleaned up (listeners, streams)
- [ ] Memory-conscious (no leaks)

---

## Before Committing

### Build Check
```bash
npm run typecheck   # Must pass
npm run lint        # Must pass
npm run build       # Must succeed
```

### Test Check
```bash
npm run test        # All tests pass
npm run test:cov    # Coverage > 80%
```

### Manual Verification
- [ ] Feature works as expected
- [ ] No console errors
- [ ] No regressions in existing features

---

## Commit Standards

### Message Format
```
type(scope): description

- detail 1
- detail 2
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `test` - Adding tests
- `docs` - Documentation
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `chore` - Maintenance

### Examples
```
feat(voice): implement Porcupine wake word detection
fix(stt): handle Deepgram connection timeout
test(llm): add unit tests for Fireworks integration
```

---

## After Task Completion

### Update PRD.md
Change task status:
```markdown
# Before
**Status**: [ ] Not Started

# After
**Status**: [x] Complete
```

### Update progress.txt
Add entry:
```markdown
### Task N: [Name] - COMPLETE ✓
**Time**: X min
**Files Changed**: N
**Tests Added**: N
**Notes**: What was done, any issues
**Commit**: abc1234
```

### Verify
```bash
git log --oneline | head -5  # See commits
npm run test                  # Tests still pass
npm run dev                   # App still works
```

---

## Phase Completion Checklist

### Phase 1: Voice Pipeline
- [ ] All 16 tasks marked [x] Complete
- [ ] npm run dev starts without errors
- [ ] "Hey Nova" triggers wake word
- [ ] Speech is transcribed correctly
- [ ] LLM responds coherently
- [ ] Response is spoken back
- [ ] All tests passing (80%+ coverage)
- [ ] README documents setup process
- [ ] Performance targets met:
  - [ ] Wake word < 200ms
  - [ ] STT < 300ms
  - [ ] LLM < 2s first token
  - [ ] TTS < 500ms first audio

---

## Emergency Procedures

### If Tests Fail
1. Read error message carefully
2. Check if test or code is wrong
3. Fix the issue
4. Re-run tests
5. If 3 attempts fail, document in blockers

### If Build Fails
1. Check TypeScript errors
2. Check for missing imports
3. Check for circular dependencies
4. Fix issues
5. Run typecheck again

### If API Fails
1. Verify API key is correct
2. Check rate limits
3. Try fallback service
4. Document in blockers if persistent

### If Stuck
1. Document the blocker in progress.txt
2. Add note to PRD.md task
3. Skip to next task
4. Create GitHub issue for later

---

## Quality Metrics Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Test Coverage | > 80% | > 60% |
| TypeScript Errors | 0 | 0 |
| ESLint Errors | 0 | 0 |
| Console Errors | 0 | 0 |
| Memory Usage | < 500MB | < 1GB |
| Startup Time | < 3s | < 10s |
| Response Latency | < 3s | < 5s |
