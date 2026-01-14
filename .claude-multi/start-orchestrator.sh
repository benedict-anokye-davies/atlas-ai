#!/bin/bash
# Start the Orchestrator Claude (Terminal 1)

echo "🎯 Starting Multi-Claude Orchestrator"
echo "======================================"
echo ""
echo "This Claude will coordinate 4 worker Claudes."
echo ""
echo "Instructions for Claude Code:"
echo "1. Read .claude-multi/ORCHESTRATOR_PROMPT.md"
echo "2. Follow the workflow loop"
echo "3. Manage workers via state.json"
echo ""
echo "Press Ctrl+C to stop the orchestrator."
echo ""
echo "======================================"
echo ""

# Set git branch
git checkout -b orchestrator 2>/dev/null || git checkout orchestrator

# Update state
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > .claude-multi/state.json <<EOF
{
  "session_id": "nova-parallel-001",
  "started_at": "$TIMESTAMP",
  "status": "active",
  "orchestrator": {
    "status": "initializing",
    "last_update": "$TIMESTAMP",
    "current_action": "Reading project documentation"
  },
  "workers": {
    "worker-1": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-1"},
    "worker-2": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-2"},
    "worker-3": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-3"},
    "worker-4": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-4"}
  },
  "task_queue": [],
  "tasks_in_progress": [],
  "tasks_completed": [],
  "tasks_failed": [],
  "errors": [],
  "metrics": {
    "total_tasks": 0,
    "completed_tasks": 0,
    "failed_tasks": 0,
    "total_commits": 0,
    "estimated_cost": 0
  }
}
EOF

echo "✅ State initialized"
echo ""
echo "📋 YOUR PROMPT FOR CLAUDE CODE:"
echo "======================================"
cat .claude-multi/ORCHESTRATOR_PROMPT.md
