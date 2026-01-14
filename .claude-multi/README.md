# 🚀 Nova Multi-Claude Autonomous System

## What This Is

A fully autonomous multi-agent system that runs 5 Claude Code instances in parallel to complete Phase 3.5 of your Nova Desktop project while you sleep.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Terminal 1)                 │
│  • Reads SESSIONS.md & creates task queue                   │
│  • Monitors worker progress via state.json                  │
│  • Reviews & merges completed branches                      │
│  • Handles errors & reassigns failed tasks                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ state.json (shared state)
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│  WORKER 1   │  │  WORKER 2   │
│  (Term 2)   │  │  (Term 3)   │
└─────────────┘  └─────────────┘
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│  WORKER 3   │  │  WORKER 4   │
│  (Term 4)   │  │  (Term 5)   │
└─────────────┘  └─────────────┘
```

## Quick Start (5 Minutes)

### Step 1: Open 5 Terminals

Use Windows Terminal with split panes or 5 separate terminal windows.

### Step 2: Start Orchestrator (Terminal 1)

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-orchestrator.bat
```

Copy the output prompt and paste it into Claude Code in Terminal 1.

### Step 3: Start Workers (Terminals 2-5)

**Terminal 2:**
```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 1
```

**Terminal 3:**
```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 2
```

**Terminal 4:**
```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 3
```

**Terminal 5:**
```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
.claude-multi\start-worker.bat 4
```

Copy each output prompt into Claude Code for that terminal.

### Step 4: Monitor Progress (Optional 6th Terminal)

```bash
cd C:\Users\Nxiss\OneDrive\Desktop\nova-desktop

# Simple monitoring
type .claude-multi\state.json

# Or watch continuously
powershell -Command "while($true) { Clear-Host; Get-Content .claude-multi\state.json | ConvertFrom-Json | ConvertTo-Json -Depth 10; Start-Sleep -Seconds 5 }"
```

### Step 5: Go to Sleep

The system will run autonomously. Each Claude knows its role and will communicate via `state.json`.

## What Gets Built Tonight

**Phase 3.5: Self-Improving Agent Foundation** (from SESSIONS.md)

- ✅ Session 033-D: Basic Evaluation Protocol (2-3 hours)
  - EvalProtocol class
  - ConversationEvaluation storage
  - Semantic chunking

- ✅ Session 033-E: Confidence Tracking (2-3 hours)
  - ConfidenceTracker class
  - Domain-specific calibration
  - Success/failure rate tracking

- ✅ Session 033-F: Failure Pattern Analysis (2-3 hours)
  - FailureAnalyzer class
  - Pattern detection
  - Automatic categorization

**Total: 6-9 hours of sequential work → 1.5-2.5 hours with 4 parallel workers**

## Cost Estimate

- **Token usage**: ~2-4M tokens (Phase 3.5 implementation)
- **Cost per 1M tokens**: ~£10-15 (Claude Sonnet)
- **Total estimated cost**: £40-80
- **Your budget**: £200+ ✅

The system tracks costs in `state.json` → `metrics.estimated_cost` and will emergency-stop if it exceeds £180.

## How It Works

### Communication Protocol

All 5 Claudes communicate through `.claude-multi/state.json`:

```json
{
  "orchestrator": {
    "status": "monitoring",
    "current_action": "Reviewing worker-2 branch"
  },
  "workers": {
    "worker-1": {
      "status": "working",
      "current_task": "T003",
      "tasks_completed": 2
    }
  },
  "task_queue": [...],      // Pending tasks
  "tasks_in_progress": [...], // Being worked on
  "tasks_completed": [...],   // Done
  "errors": [...]            // Issues
}
```

### Git Workflow

- **master**: Production branch (you never touch during sleep)
- **orchestrator**: Orchestrator's coordination branch
- **worker-1 through worker-4**: Worker execution branches

When a task completes:
1. Worker commits to their branch
2. Worker updates state.json
3. Orchestrator sees completion
4. Orchestrator reviews diff
5. Orchestrator merges to master

### Error Recovery

If a worker gets stuck:
1. Worker adds error to state.json
2. Worker sets status to "blocked"
3. Orchestrator detects blockage
4. Orchestrator either:
   - Provides clarification in state.json
   - Reassigns task to another worker
   - Breaks task into smaller pieces

### Safety Features

- ✅ Workers use separate branches (no conflicts)
- ✅ Orchestrator reviews before merging
- ✅ Automatic cost tracking
- ✅ Emergency stop at £180
- ✅ Error logging for debugging
- ✅ Continuous state persistence

## Monitoring While It Runs

### Check Progress

```bash
# See current state
type .claude-multi\state.json

# See completed tasks
git log --oneline --all --graph

# See what workers are doing
git branch -a

# Check a specific worker's work
git diff master..worker-1
```

### Dashboard (PowerShell)

```powershell
while($true) {
  Clear-Host
  Write-Host "=== NOVA MULTI-CLAUDE DASHBOARD ===" -ForegroundColor Cyan
  Write-Host ""

  $state = Get-Content .claude-multi\state.json | ConvertFrom-Json

  Write-Host "Status: $($state.status)" -ForegroundColor Green
  Write-Host "Completed: $($state.metrics.completed_tasks)/$($state.metrics.total_tasks)"
  Write-Host "Cost: £$($state.metrics.estimated_cost)"
  Write-Host ""

  Write-Host "Workers:" -ForegroundColor Yellow
  $state.workers.PSObject.Properties | ForEach-Object {
    $w = $_.Value
    Write-Host "  $($_.Name): $($w.status) | Task: $($w.current_task) | Done: $($w.tasks_completed)"
  }

  Start-Sleep -Seconds 5
}
```

## When You Wake Up

### Expected Results

1. **Code Changes**: 12-16 new files in `src/main/agent/` and `src/main/memory/`
2. **Git Commits**: 15-20 commits across worker branches, all merged to master
3. **Tests**: New test files in `tests/`
4. **State File**: Complete log in `.claude-multi/state.json`
5. **Documentation**: Updated SESSIONS.md with completion markers

### Verification Commands

```bash
# See all the work done
git log --since="8 hours ago" --oneline

# Run tests
npm run test

# Check TypeScript
npm run typecheck

# See the new files
git diff HEAD~20..HEAD --stat

# Read final state
type .claude-multi\state.json
```

### If Something Went Wrong

Check `.claude-multi/state.json` → `errors` array for what happened.

Common issues:
- **Worker stuck**: Last update timestamp is old → manual restart needed
- **Merge conflict**: Orchestrator couldn't auto-merge → resolve manually
- **Cost exceeded**: Hit the £180 limit → manually complete remaining tasks
- **Test failures**: Code written but tests failing → debug in the morning

## Troubleshooting

### Workers Not Starting

```bash
# Make sure you're on the right branch
git branch

# Should show: worker-1, worker-2, etc.
# If not:
git checkout -b worker-1
```

### State.json Not Updating

```bash
# Check file permissions
icacls .claude-multi\state.json

# Reinitialize if corrupted
.claude-multi\start-orchestrator.bat
```

### Git Conflicts

```bash
# See what's conflicted
git status

# Let orchestrator handle it, or manually:
git checkout master
git merge worker-1
# Resolve conflicts
git commit
```

### Costs Too High

The orchestrator tracks costs and will stop at £180. If you want to change the limit:

Edit `.claude-multi/ORCHESTRATOR_PROMPT.md` line with "Cost exceeds £180"

## Manual Intervention

If you need to help mid-sleep:

```bash
# See what's happening
type .claude-multi\state.json

# Take over a task
git checkout worker-1
# ... make changes ...
git commit -m "manual: fix worker-1 stuck task"
git push

# Update state.json manually
# Set worker-1.status = "idle"
# Move task from tasks_in_progress to tasks_completed
```

## Architecture Details

### Why This Works

1. **Stateless Communication**: All state in one JSON file
2. **Git Isolation**: Each worker has own branch, no conflicts
3. **Clear Protocols**: Every Claude knows exactly what to do
4. **Autonomous Loops**: Claudes check state every 30-60 seconds
5. **Coordinator Pattern**: Orchestrator handles integration

### Inspired By

- Boris's Claude Code cheatsheet (parallel workflows)
- Fireworks AI compounding engineering pattern
- Traditional distributed task queues (Celery, RQ)
- Actor model (Erlang/Akka)

## Files Created

```
.claude-multi/
├── state.json                  # Shared state (the "message bus")
├── ORCHESTRATOR_PROMPT.md      # Instructions for orchestrator
├── WORKER_PROMPT.md            # Instructions for workers
├── start-orchestrator.bat      # Windows launcher for orchestrator
├── start-worker.bat            # Windows launcher for workers
├── start-orchestrator.sh       # Linux/Mac launcher for orchestrator
├── start-worker.sh             # Linux/Mac launcher for workers
├── monitor-dashboard.sh        # Real-time monitoring (bash)
├── START_HERE.md               # Quick start guide
└── README.md                   # This file
```

## Next Steps After Phase 3.5

Once Phase 3.5 completes, you can:

1. **Continue to Phase 6.5**: Update orchestrator prompt to target GEPA sessions (045-D through 045-G)
2. **Run more workers**: Scale to 8-10 workers for faster completion
3. **Target other phases**: Point at any phase in SESSIONS.md

## Support

If something breaks catastrophically:

1. Read `.claude-multi/state.json` errors
2. Check git status: `git status`
3. Check git log: `git log --oneline -20`
4. Worst case: `git reset --hard origin/master` and restart

## Cost Tracking

The orchestrator estimates costs based on:
- Tokens used per task
- Number of tasks completed
- Average £15 per 1M tokens

Check current cost: `type .claude-multi\state.json | findstr estimated_cost`

## Good Luck on Your Exam! 🎓

The Claudes will work through Phase 3.5 while you sleep. When you wake up, you'll have:
- A self-improving agent foundation
- Evaluation protocol working
- Confidence tracking implemented
- Failure pattern analysis ready
- All code tested and merged

**Now go run those batch files and get some sleep!**
