# Visual Setup Guide

## Your Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR DESKTOP LAYOUT                          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┬──────────────────────────┬───────────┐
│                          │                          │           │
│   TERMINAL 1             │   TERMINAL 2             │  TERMINAL │
│   (Orchestrator)         │   (Worker 1)             │     3     │
│                          │                          │ (Worker 2)│
│   "I'm the coordinator"  │   "I build eval system"  │           │
│                          │                          │           │
├──────────────────────────┼──────────────────────────┼───────────┤
│                          │                          │           │
│   TERMINAL 4             │   TERMINAL 5             │ TERMINAL  │
│   (Worker 3)             │   (Worker 4)             │    6      │
│                          │                          │ (Monitor) │
│   "I build confidence"   │   "I build analyzer"     │ OPTIONAL  │
│                          │                          │           │
└──────────────────────────┴──────────────────────────┴───────────┘
```

## Window Setup Options

### Option 1: Windows Terminal (Recommended)

1. Open Windows Terminal
2. Right-click on tab → "Split Pane" → "Split Vertically" (4 times)
3. In each pane, navigate to project: `cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop`
4. Run the start script in each pane

**Layout:**
```
┌─────────┬─────────┬─────────┐
│    1    │    2    │    3    │
├─────────┼─────────┼─────────┤
│    4    │    5    │    6    │
└─────────┴─────────┴─────────┘
```

### Option 2: Separate Windows

Just run `.claude-multi\START_ALL.bat` and it opens 5 windows automatically.

### Option 3: VS Code Terminal

1. Open VS Code in project folder
2. Terminal → Split Terminal (4 times)
3. Run start scripts in each split

## What Each Terminal Shows

### Terminal 1: Orchestrator 🎯

```
============================================
  NOVA MULTI-CLAUDE ORCHESTRATOR
============================================

This Claude will coordinate 4 worker Claudes.

Instructions for Claude Code:
1. Read .claude-multi/ORCHESTRATOR_PROMPT.md
2. Follow the workflow loop
3. Manage workers via state.json

============================================
COPY THIS PROMPT TO CLAUDE CODE:
============================================

# ORCHESTRATOR TERMINAL - Claude Code Multi-Agent Coordinator

You are the **ORCHESTRATOR** for a multi-agent Claude Code...
[... full prompt ...]
```

**What to do:**
1. Select all the text starting from "# ORCHESTRATOR TERMINAL"
2. Copy it (Ctrl+C)
3. Open Claude Code CLI: type `claude-code` and press Enter
4. Paste the prompt (Ctrl+V)
5. Press Enter
6. Watch it start reading files

### Terminal 2-5: Workers 🤖

```
============================================
  NOVA WORKER CLAUDE #1
============================================

This Claude will execute tasks from the queue.

Instructions for Claude Code:
1. Read .claude-multi/WORKER_PROMPT.md
2. Replace {N} with 1 everywhere
3. Follow the workflow loop
4. Claim tasks from state.json

============================================
COPY THIS PROMPT TO CLAUDE CODE:
============================================

# WORKER TERMINAL - Claude Code Multi-Agent Worker

You are **WORKER-1** in a multi-agent Claude Code system...
[... full prompt ...]
```

**What to do:**
1. Same as orchestrator - copy from "# WORKER TERMINAL"
2. Paste into Claude Code
3. Each worker will wait for tasks

### Terminal 6: Monitor (Optional) 📊

```powershell
# Run this for live updates
while($true) {
  Clear-Host
  Write-Host "=== NOVA PROGRESS ===" -ForegroundColor Cyan
  $state = Get-Content .claude-multi\state.json | ConvertFrom-Json
  Write-Host "Completed: $($state.metrics.completed_tasks)/$($state.metrics.total_tasks)"
  Write-Host "Cost: £$($state.metrics.estimated_cost)"
  Start-Sleep 5
}
```

## The Flow (First 5 Minutes)

### Minute 0-1: Startup
```
Orchestrator: "Reading SESSIONS.md..."
Worker 1-4:   "Waiting for tasks..."
state.json:   { "status": "initializing" }
```

### Minute 1-2: Planning
```
Orchestrator: "Creating task queue from Phase 3.5..."
Worker 1-4:   "Checking state.json..."
state.json:   { "task_queue": [8 tasks], "status": "active" }
```

### Minute 2-3: Task Claiming
```
Orchestrator: "Monitoring workers..."
Worker 1:     "Claimed task T001 - EvalProtocol base class"
Worker 2:     "Claimed task T002 - ConversationEvaluation types"
Worker 3:     "Claimed task T003 - Semantic chunking utility"
Worker 4:     "Claimed task T004 - Test setup"
state.json:   { "tasks_in_progress": [4 tasks] }
```

### Minute 3-5: Full Speed
```
Orchestrator: "Reviewing worker-1 branch..."
Worker 1:     "Creating src/main/agent/eval/protocol.ts..."
Worker 2:     "Creating src/shared/types/eval.ts..."
Worker 3:     "Creating src/main/utils/chunking.ts..."
Worker 4:     "Creating tests/eval-setup.test.ts..."
Git:          [worker branches showing commits]
```

## Visual Indicators of Success

### ✅ Orchestrator Working
- Mentions reading SESSIONS.md
- Mentions creating tasks
- Mentions reviewing branches
- Mentions merging code

### ✅ Workers Working
- Shows "claimed task T00X"
- Shows file paths being created
- Shows "running tests"
- Shows "committing to worker-N branch"

### ✅ System Healthy
- state.json updates every 1-2 minutes
- Git log shows new commits
- `git branch` shows 5 branches
- No "ERROR" or "BLOCKED" in worker statuses

## Visual Indicators of Problems

### ⚠️ Worker Stuck
- Same task for >20 minutes
- No git commits in 15 minutes
- Status = "blocked" in state.json

**Fix:** Tell orchestrator: "Worker-N is stuck on task X. Reassign it."

### ⚠️ Orchestrator Stuck
- No tasks in task_queue after 5 minutes
- Status = "waiting" but workers idle

**Fix:** Tell orchestrator: "Create the first 8 tasks from SELF_IMPROVING_AGENT_PLAN.md"

### 🚨 System Crashed
- Claude Code exits with error
- Git repository corrupted
- state.json missing

**Fix:** Restart that terminal with the start script. State is preserved.

## File Tree Changes Over Time

### Start (Minute 0)
```
nova-desktop/
├── src/
├── tests/
├── SESSIONS.md
├── SELF_IMPROVING_AGENT_PLAN.md
└── .claude-multi/
    └── state.json
```

### After 30 Minutes
```
nova-desktop/
├── src/
│   └── main/
│       └── agent/
│           └── eval/
│               ├── protocol.ts     ← NEW
│               ├── confidence.ts   ← NEW
│               └── index.ts        ← NEW
├── tests/
│   ├── eval.test.ts               ← NEW
│   └── confidence.test.ts         ← NEW
├── SESSIONS.md
├── SELF_IMPROVING_AGENT_PLAN.md
└── .claude-multi/
    └── state.json (updated with progress)
```

### After 2-3 Hours (Complete)
```
nova-desktop/
├── src/
│   └── main/
│       ├── agent/
│       │   └── eval/
│       │       ├── protocol.ts          ✅
│       │       ├── confidence.ts        ✅
│       │       ├── failure-analyzer.ts  ✅
│       │       └── index.ts             ✅
│       └── memory/
│           └── stores/
│               └── evaluation.ts        ✅
├── tests/
│   ├── eval.test.ts                     ✅
│   ├── confidence.test.ts               ✅
│   └── failure-analyzer.test.ts         ✅
├── SESSIONS.md (updated with ✅ markers)
└── .claude-multi/
    └── state.json (status: "completed")
```

## Commands Cheat Sheet

### Quick Status Check
```bash
# See progress
type .claude-multi\state.json | findstr completed

# See active workers
type .claude-multi\state.json | findstr status

# See recent commits
git log --oneline -10

# See all branches
git branch -a
```

### Quick Intervention
```bash
# Help stuck worker
# (In orchestrator terminal)
Worker-2 is stuck. Reassign task T005 to worker-3.

# Add more tasks
# (In orchestrator terminal)
Create 4 more tasks for Session 033-E and add to task_queue.

# Check specific worker's work
git diff master..worker-2
```

## What You'll See When You Wake Up

### In state.json
```json
{
  "status": "completed",
  "metrics": {
    "total_tasks": 16,
    "completed_tasks": 16,
    "failed_tasks": 0,
    "estimated_cost": 65
  },
  "tasks_completed": [
    { "task_id": "T001", "title": "EvalProtocol base class", ... },
    { "task_id": "T002", "title": "ConversationEvaluation types", ... },
    ...
  ]
}
```

### In Git
```bash
git log --oneline -20
# Shows 15-20 commits like:
# abc1234 feat: implement failure pattern analyzer
# def5678 feat: add confidence tracker
# ...
```

### In Your File System
- 12-16 new TypeScript files
- 6-8 new test files
- Updated documentation
- All tests passing
- All code merged to master

---

**That's it! Follow the visual guide and you're set. Good luck on your exam!** 🎓
