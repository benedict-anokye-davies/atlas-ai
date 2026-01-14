# How to Run the Multi-Claude System

## Step-by-Step (5 Minutes Total)

### 1. Double-click this file:
```
.claude-multi\START_ALL.bat
```

This will open **5 terminal windows** automatically.

---

### 2. In EACH of the 5 windows, do this:

**You'll see a big block of text (the prompt). Do this:**

1. **Select ALL the text** (Ctrl+A)
2. **Copy it** (Ctrl+C)
3. **Type:** `claude`
4. **Paste** the text (Ctrl+V)
5. **Press Enter**

**Repeat for all 5 windows.**

---

### 3. That's it! Go to sleep.

The 5 Claudes will now work autonomously for 6-8 hours building your self-improving agent system.

---

## What Each Window Does

- **Window 1 (Orchestrator)**: Creates tasks, coordinates workers, merges code
- **Windows 2-5 (Workers)**: Execute tasks, write code, run tests

All 5 Claudes communicate via the `.claude-multi/state.json` file.

---

## Checking Progress (Optional)

Open a 6th terminal and run:
```bash
type .claude-multi\state.json
```

This shows:
- How many tasks completed
- What each worker is doing
- Any errors

But you don't need to check - it runs fully autonomously.

---

## When You Wake Up

Run these commands:
```bash
# Check if complete
type .claude-multi\state.json | findstr status
# Should show: "status": "completed"

# Run tests
npm run test
# Should pass ✅

# Check TypeScript
npm run typecheck
# Should pass ✅
```

---

## After It's Complete

**Nova will work exactly the same**, but now:
- ✅ Learns from every conversation
- ✅ Tracks confidence by topic
- ✅ Improves its own prompts automatically
- ✅ Gets smarter over time

You just talk to Nova normally - the learning happens in the background.

---

## Troubleshooting

**Issue: Windows close immediately**
- Right-click START_ALL.bat → Run as Administrator

**Issue: "claude" command not found**
- Install Claude Code CLI first: https://docs.anthropic.com/en/docs/claude-code

**Issue: Workers say "no tasks"**
- Wait 2-3 minutes for orchestrator to create tasks

**Issue: Something broke**
- Check `.claude-multi/state.json` for errors
- Or just restart: run START_ALL.bat again

---

## Cost Tracking

The system tracks costs in `state.json` under `metrics.estimated_cost`

Expected: £120-165
No limit: System won't stop for budget reasons

---

## That's It!

Just run **START_ALL.bat**, paste prompts in each window, and sleep.

When you wake up, Nova will have a complete self-improving agent system.

**Good luck on your exam!** 🎓
