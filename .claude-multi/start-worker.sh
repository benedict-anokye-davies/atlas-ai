#!/bin/bash
# Start a Worker Claude (Terminals 2-5)

WORKER_ID=$1

if [ -z "$WORKER_ID" ]; then
  echo "Usage: ./start-worker.sh <worker-number>"
  echo "Example: ./start-worker.sh 1"
  exit 1
fi

echo "🤖 Starting Worker Claude #$WORKER_ID"
echo "======================================"
echo ""
echo "This Claude will execute tasks from the queue."
echo ""
echo "Instructions for Claude Code:"
echo "1. Read .claude-multi/WORKER_PROMPT.md"
echo "2. Replace {N} with $WORKER_ID everywhere"
echo "3. Follow the workflow loop"
echo "4. Claim tasks from state.json"
echo ""
echo "Press Ctrl+C to stop this worker."
echo ""
echo "======================================"
echo ""

# Set git branch
BRANCH="worker-$WORKER_ID"
git checkout -b $BRANCH 2>/dev/null || git checkout $BRANCH
git push -u origin $BRANCH 2>/dev/null || true

echo "✅ Branch ready: $BRANCH"
echo ""
echo "📋 YOUR PROMPT FOR CLAUDE CODE:"
echo "======================================"
sed "s/{N}/$WORKER_ID/g" .claude-multi/WORKER_PROMPT.md
