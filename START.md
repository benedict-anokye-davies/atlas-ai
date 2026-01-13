# Nova Desktop - Quick Start Guide

## Project Location
```
C:\Users\Nxiss\OneDrive\Desktop\nova-desktop
```

---

## Step 1: Add Your API Keys (2 minutes)

Edit the `.env` file and add your keys:
```bash
# Open in editor
notepad .env
# Or use VS Code
code .env
```

Fill in:
```env
PORCUPINE_API_KEY=your_key_here
DEEPGRAM_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
FIREWORKS_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

---

## Step 2: Open Git Bash

1. Right-click on the `nova-desktop` folder
2. Select "Git Bash Here"

Or open Git Bash and run:
```bash
cd /c/Users/Nxiss/OneDrive/Desktop/nova-desktop
```

---

## Step 3: Test Single Iteration (5 minutes)

Run one iteration to make sure everything works:
```bash
./ralph.sh
```

This will:
- Read PRD.md and find Task 1
- Set up Electron + React + TypeScript
- Create initial project files
- Commit the changes

**Watch the output** - if it works, continue to Step 4.

---

## Step 4: Run Autonomous Build (Overnight)

### Option A: Run in Foreground (Watch Progress)
```bash
./auto-build.sh 50
```

### Option B: Run in Background (Go to Sleep)
```bash
./auto-build.sh 50 > build.log 2>&1 &
echo "Building in background. Check build.log for progress."
```

### Option C: Run with Monitoring (Two Terminals)

**Terminal 1 - Build:**
```bash
./auto-build.sh 50
```

**Terminal 2 - Monitor:**
```bash
./scripts/monitor.sh
```

---

## Step 5: Morning Check

When you wake up:
```bash
# See what was built
git log --oneline | head -20

# Check progress
cat progress.txt

# Try running the app
npm run dev
```

---

## Quick Commands Reference

| Command | What it does |
|---------|--------------|
| `./ralph.sh` | Run one development iteration |
| `./auto-build.sh 50` | Run 50 autonomous iterations |
| `./scripts/monitor.sh` | Watch build progress |
| `./scripts/research.sh "query"` | Research with Perplexity |
| `git log --oneline` | See commits |
| `cat progress.txt` | See progress log |

---

## Troubleshooting

### "opencode: command not found"
OpenCode may not be installed. Options:

**Option 1**: Run me (the current OpenCode session) as the orchestrator:
- Just tell me: "Start building Task 1"
- I'll implement it directly with my sub-agents

**Option 2**: Install opencode CLI:
```bash
npm install -g opencode
```

### "Permission denied"
Make scripts executable:
```bash
chmod +x ralph.sh auto-build.sh scripts/*.sh
```

### "API key not working"
1. Check .env file has the key
2. Verify key is valid at the provider's dashboard
3. Check rate limits

---

## Alternative: Use ME as Orchestrator

Instead of running scripts, you can use this OpenCode session directly:

**Tell me:**
> "Start building Nova. Implement Task 1 from PRD.md"

I will:
1. Read the PRD
2. Implement the task with sub-agents
3. Write tests
4. Commit changes
5. Update progress

Then say:
> "Continue with Task 2"

**Advantages:**
- Real-time feedback
- I can ask clarifying questions
- Better error handling
- Can spawn parallel sub-agents

---

## What Gets Built (Phase 1)

| Task | Feature | Time Est |
|------|---------|----------|
| 1 | Electron + React + TypeScript | 30-45 min |
| 2 | Environment & Config | 15-20 min |
| 3 | Logging System | 20-30 min |
| 4 | Error Handling | 25-35 min |
| 5 | Wake Word (Porcupine) | 45-60 min |
| 6 | Voice Activity Detection | 30-40 min |
| 7 | Audio Pipeline | 40-50 min |
| 8 | STT (Deepgram) | 35-45 min |
| 9 | Offline STT Fallback | 30-40 min |
| 10 | LLM (Fireworks) | 40-50 min |
| 11 | LLM Fallback | 20-30 min |
| 12 | TTS (ElevenLabs) | 35-45 min |
| 13 | Offline TTS Fallback | 25-35 min |
| 14 | Test Suite | 45-60 min |
| 15 | Performance Optimization | 30-40 min |
| 16 | Documentation | 30-40 min |

**Total: ~8-10 hours autonomous** (or 50-70 iterations)

---

## Success Criteria

Phase 1 is complete when:
- [ ] You say "Hey Nova"
- [ ] Nova hears you and transcribes
- [ ] Nova responds intelligently
- [ ] You hear Nova's voice response
- [ ] All tests pass (80%+ coverage)

---

## Next Steps After Phase 1

1. **Phase 2**: Visual Orb (React Three Fiber)
2. **Phase 3**: Agent Tools (files, browser, terminal)
3. **Phase 4**: Memory System (LanceDB, Mem0)

---

## Start Now!

```bash
# Open Git Bash in nova-desktop folder, then:
./ralph.sh
```

Or tell me:
> "Start building Task 1"

Let's build Nova! 🚀
