#!/bin/bash
# ralph.sh - Single iteration of Nova development
# Run one task, test, commit, update progress

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  NOVA RALPH - Single Task Iteration"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════"

# Check if opencode is available
if ! command -v opencode &> /dev/null; then
    echo "ERROR: opencode not found. Install with: npm install -g @anthropic-ai/opencode"
    exit 1
fi

# Run OpenCode with PRD and progress context
opencode -p "
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
"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Iteration complete. Check git log for commits."
echo "═══════════════════════════════════════════════════════════"
