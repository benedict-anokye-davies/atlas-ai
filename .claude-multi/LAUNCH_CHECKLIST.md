# 🚀 Launch Checklist - Multi-Claude System

## Pre-Flight Check (2 minutes)

### 1. Verify Git Status
```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
git status
```

✅ Should be on `master` branch
✅ Working directory should be relatively clean
⚠️  If you have uncommitted changes, commit them first

### 2. Verify Documentation Exists
```bash
dir SESSIONS.md
dir SELF_IMPROVING_AGENT_PLAN.md
```

✅ Both files should exist
✅ SESSIONS.md should have Phase 3.5 (lines 886-964)

### 3. Verify Dependencies
```bash
npm install
npm run typecheck
```

✅ No missing dependencies
✅ TypeScript should compile (warnings OK, errors not OK)

### 4. Check API Keys
```bash
type src\main\config\index.ts | findstr /i "api"
```

✅ Fireworks API key is set
✅ Other API keys configured

---

## Launch Sequence (5 minutes)

### Terminal 1: Orchestrator 🎯

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-orchestrator.bat
```

**What you'll see:**
- Git creates `orchestrator` branch
- Script displays the orchestrator prompt
- state.json is initialized

**Action:**
1. Copy the prompt from the terminal
2. Open Claude Code in this terminal
3. Paste the prompt
4. Hit Enter

**Expected response from Claude:**
"I'll start by reading SESSIONS.md and SELF_IMPROVING_AGENT_PLAN.md to understand Phase 3.5..."

✅ Orchestrator is running when you see it reading files

---

### Terminal 2: Worker 1 🤖

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 1
```

**What you'll see:**
- Git creates `worker-1` branch
- Script displays the worker prompt with {N} replaced by 1

**Action:**
1. Copy the prompt
2. Open Claude Code in this terminal
3. Paste the prompt
4. Hit Enter

**Expected response:**
"I'll start by reading state.json and looking for tasks..."

✅ Worker is running when you see it checking state.json

---

### Terminal 3: Worker 2 🤖

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 2
```

Same process as Worker 1.

---

### Terminal 4: Worker 3 🤖

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 3
```

Same process as Worker 1.

---

### Terminal 5: Worker 4 🤖

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 4
```

Same process as Worker 1.

---

### Terminal 6 (Optional): Monitor 📊

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop

# Simple check
type .claude-multi\state.json

# Continuous monitoring
powershell -Command "while($true) { Clear-Host; Write-Host '=== NOVA DASHBOARD ===' -ForegroundColor Cyan; Get-Content .claude-multi\state.json | ConvertFrom-Json | Format-List; Start-Sleep 5 }"
```

---

## Verification (1 minute)

After all 5 Claudes are running, verify:

### Check 1: All branches exist
```bash
git branch
```

Expected output:
```
* master
  orchestrator
  worker-1
  worker-2
  worker-3
  worker-4
```

### Check 2: State.json is active
```bash
type .claude-multi\state.json | findstr status
```

Expected output should include: `"status": "active"`

### Check 3: Tasks are being created
```bash
type .claude-multi\state.json | findstr task_queue
```

Should see some tasks in the queue after 2-3 minutes.

### Check 4: Workers are claiming tasks
```bash
type .claude-multi\state.json | findstr current_task
```

Should see some workers with non-null current_task after 3-5 minutes.

---

## System Running Indicators

✅ **Orchestrator is working when:**
- It's reading SESSIONS.md
- It's creating tasks in task_queue
- It's checking worker branches
- It's merging completed work

✅ **Workers are working when:**
- They're reading state.json
- They have a current_task assigned
- They're creating/modifying files
- They're running tests
- They're committing to their branch

✅ **System is autonomous when:**
- All 5 Claudes are actively responding
- task_queue is being populated
- tasks_in_progress is growing
- tasks_completed is accumulating
- Git commits are appearing

---

## What To Watch For (First 10 Minutes)

### Minute 0-2: Initialization
- Orchestrator reads documentation
- Workers wait for tasks
- state.json gets populated

### Minute 2-5: First Tasks
- Orchestrator creates 4-8 tasks
- Workers claim tasks
- First files being created

### Minute 5-10: Full Speed
- All 4 workers active
- Commits appearing in git log
- tasks_completed growing
- Orchestrator reviewing/merging

---

## Troubleshooting Quick Reference

### Issue: Worker says "no tasks available"
**Fix:** Wait 2-3 minutes for orchestrator to create tasks

### Issue: Orchestrator not creating tasks
**Fix:** Check if it's stuck reading files. Give it this prompt:
```
Create the first 8 tasks from SELF_IMPROVING_AGENT_PLAN.md and add them to state.json task_queue
```

### Issue: Worker stuck on same task for >20min
**Fix:** In orchestrator terminal:
```
Worker-N has been stuck on task X for 20 minutes. Reassign it to another worker.
```

### Issue: Git conflicts
**Fix:** Orchestrator should handle automatically. If not:
```bash
git checkout master
git merge worker-1
# Resolve conflicts manually
git commit
```

### Issue: Cost too high
**Fix:** Check state.json estimated_cost. Emergency stop if needed:
```
EMERGENCY STOP: Cost limit reached. Complete current tasks and stop.
```

---

## Expected Timeline

| Time | What's Happening | Progress |
|------|------------------|----------|
| 0:00 | System starts | 0% |
| 0:05 | First tasks claimed | 5% |
| 0:15 | All workers active | 15% |
| 0:30 | First tasks completed | 25% |
| 1:00 | Session 033-D in progress | 40% |
| 1:30 | Session 033-E starting | 60% |
| 2:00 | Session 033-F starting | 80% |
| 2:30 | Cleanup and tests | 95% |
| 3:00 | Phase 3.5 complete | 100% |

---

## Success Criteria

When you wake up, you should have:

✅ **Files Created:**
- `src/main/agent/eval/protocol.ts`
- `src/main/agent/eval/confidence.ts`
- `src/main/agent/eval/failure-analyzer.ts`
- `tests/eval.test.ts`
- `tests/confidence.test.ts`
- `tests/failure-analyzer.test.ts`

✅ **Git:**
- 15-25 commits since you started
- All worker branches merged to master
- Clean git status

✅ **Tests:**
- `npm run test` passes
- `npm run typecheck` passes (or only minor warnings)

✅ **Documentation:**
- state.json shows status: "completed"
- tasks_completed has 12-16 items
- No critical errors in errors array

---

## Emergency Procedures

### ABORT MISSION
If you need to stop everything:

```bash
# Kill all Claude Code processes
taskkill /F /IM "Code.exe" /FI "WINDOWTITLE eq Claude*"

# Or manually close all 5 terminal windows
```

### RESUME MISSION
If you stopped and want to restart:

```bash
# Each terminal, run the same command as before
# Orchestrator:
.claude-multi\start-orchestrator.bat

# Workers 1-4:
.claude-multi\start-worker.bat 1
.claude-multi\start-worker.bat 2
.claude-multi\start-worker.bat 3
.claude-multi\start-worker.bat 4
```

They'll resume from state.json automatically.

---

## Final Check Before Sleep

Before you go to sleep, verify:

- [ ] All 5 Claude Code windows are open and active
- [ ] Orchestrator has created tasks (check state.json)
- [ ] At least 2 workers have claimed tasks
- [ ] Git branches exist (git branch shows 5 branches)
- [ ] No critical errors in any terminal
- [ ] state.json status is "active"

**If all checked, you're good to sleep!**

---

## Good Luck! 🎓

Your Claudes will work on Phase 3.5 while you rest. When you wake up, you'll have a self-improving agent foundation ready to go.

**Focus on your exam. The code will be ready when you return.**
