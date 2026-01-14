# 🚀 Nova Multi-Claude Autonomous System

## Quick Start (5 Terminals)

### Terminal 1: Orchestrator
```bash
cd nova-desktop
bash .claude-multi/start-orchestrator.sh
# Then copy the prompt into Claude Code
```

### Terminal 2-5: Workers
```bash
# Terminal 2
cd nova-desktop
bash .claude-multi/start-worker.sh 1

# Terminal 3
cd nova-desktop
bash .claude-multi/start-worker.sh 2

# Terminal 4
cd nova-desktop
bash .claude-multi/start-worker.sh 3

# Terminal 5
cd nova-desktop
bash .claude-multi/start-worker.sh 4
```

## What Happens

1. **Orchestrator** reads SESSIONS.md Phase 3.5 and creates task queue
2. **Workers** claim tasks from the queue and execute them
3. **All Claudes** communicate via `.claude-multi/state.json`
4. **Orchestrator** merges completed work from worker branches
5. **System runs autonomously** until Phase 3.5 is complete

## Monitoring Progress

Watch state.json in real-time:
```bash
watch -n 5 cat .claude-multi/state.json
```

Or use the dashboard:
```bash
npm run dashboard  # If you want me to create this
```

## Expected Output by Morning

- ✅ 12-16 tasks completed (Phase 3.5: Sessions 033-D, 033-E, 033-F)
- ✅ All code merged to master branch
- ✅ Tests passing
- ✅ TypeScript compiling
- ✅ Detailed progress log in state.json

## Cost Estimate

- **Phase 3.5**: ~8 hours of work
- **5 parallel Claudes**: ~1.6 hours real time
- **Estimated cost**: £40-80 (depending on token usage)
- **Your budget**: £200+ (plenty of headroom)

## Safety Features

- Workers use separate branches (no conflicts)
- Orchestrator reviews all merges
- Automatic error recovery
- Cost tracking in state.json
- Emergency stop if cost > £180

## Troubleshooting

**Workers not picking up tasks?**
- Check state.json has tasks in task_queue
- Verify worker branch exists: `git branch -a`

**Orchestrator not creating tasks?**
- Manually read state.json and verify it's in "active" status
- Check orchestrator branch: `git checkout orchestrator`

**Merge conflicts?**
- Orchestrator will handle them automatically
- Worst case: orchestrator will ask you in the morning

## Manual Override

If you need to intervene:
```bash
# See all branches
git branch -a

# Check a worker's progress
git diff master..worker-1

# Merge manually if needed
git checkout master
git merge worker-1
```

## The Secret Sauce

This works because:
1. **Shared state file** (state.json) = message bus
2. **Git branches** = isolated workspaces
3. **Clear protocols** = no confusion
4. **Orchestrator** = coordinator + reviewer
5. **Autonomous loops** = keeps running

## Start Command Summary

```bash
# Terminal 1 (Orchestrator)
bash .claude-multi/start-orchestrator.sh

# Terminal 2-5 (Workers)
bash .claude-multi/start-worker.sh 1
bash .claude-multi/start-worker.sh 2
bash .claude-multi/start-worker.sh 3
bash .claude-multi/start-worker.sh 4
```

**Now go to sleep. The Claudes will handle Phase 3.5 tonight.**

Good luck on your exam! 🎓
