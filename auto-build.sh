#!/bin/bash
# auto-build.sh - Autonomous Nova development loop
# Runs multiple iterations until complete or max reached

set -e

# Configuration
MAX_ITERATIONS=${1:-50}
SLEEP_BETWEEN=${2:-5}
LOG_FILE="build.log"

echo "═══════════════════════════════════════════════════════════"
echo "  NOVA AUTO-BUILD - Autonomous Development"
echo "  Max Iterations: $MAX_ITERATIONS"
echo "  Sleep Between: ${SLEEP_BETWEEN}s"
echo "  Started: $(date)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if opencode is available
if ! command -v opencode &> /dev/null; then
    echo "ERROR: opencode not found. Install with: npm install -g @anthropic-ai/opencode"
    exit 1
fi

# Main loop
for ((i=1; i<=MAX_ITERATIONS; i++)); do
    echo ""
    echo "┌─────────────────────────────────────────────────────────┐"
    echo "│  ITERATION $i / $MAX_ITERATIONS - $(date '+%H:%M:%S')"
    echo "└─────────────────────────────────────────────────────────┘"
    
    # Run OpenCode
    result=$(opencode -p "
You are building Nova, a voice-first AI assistant.

Read these files carefully:
- @PRD.md - Full requirements with sub-tasks
- @progress.txt - Current progress  
- @ORCHESTRATOR.md - How to work on this project

YOUR TASK:
1. Find the NEXT incomplete task in PRD.md (marked '[ ] Not Started')
2. Implement ALL sub-tasks for that ONE task
3. Write tests for your implementation
4. Run tests to verify: npm run test (create test script if needed)
5. Update PRD.md: Change '[ ] Not Started' to '[x] Complete' for completed items
6. Update progress.txt with a summary of what you did
7. Stage and commit changes: git add -A && git commit -m 'feat(phase1): task N - description'

STRICT RULES:
- Complete ONE full task per run (all its sub-tasks)
- Tests MUST pass before committing
- If a sub-task is blocked, document why and continue
- Be thorough - implement production-quality code

OUTPUT:
- Summary of what was implemented
- Any blockers encountered
- If ALL 16 tasks are complete, output: <COMPLETE/>
" 2>&1) || true
    
    echo "$result"
    
    # Check for completion
    if [[ "$result" == *"<COMPLETE/>"* ]]; then
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  ✅ PHASE 1 COMPLETE!"
        echo "  Total Iterations: $i"
        echo "  Finished: $(date)"
        echo "═══════════════════════════════════════════════════════════"
        
        # Show summary
        echo ""
        echo "Git commits:"
        git log --oneline | head -20
        
        echo ""
        echo "Next steps:"
        echo "  1. npm run dev     - Test the app"
        echo "  2. Say 'Hey Nova'  - Test voice"
        echo "  3. Check build.log - Review details"
        
        exit 0
    fi
    
    # Check for errors that should stop the loop
    if [[ "$result" == *"ERROR"* ]] || [[ "$result" == *"FATAL"* ]]; then
        echo ""
        echo "⚠️  Error detected. Continuing anyway..."
    fi
    
    # Sleep between iterations
    echo ""
    echo "Sleeping ${SLEEP_BETWEEN}s before next iteration..."
    sleep $SLEEP_BETWEEN
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Max iterations ($MAX_ITERATIONS) reached."
echo "  Check progress.txt for current status."
echo "═══════════════════════════════════════════════════════════"
