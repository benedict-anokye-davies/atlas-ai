#!/bin/bash
# Real-time dashboard for monitoring multi-Claude progress

clear

while true; do
  clear
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║           NOVA MULTI-CLAUDE AUTONOMOUS SYSTEM                  ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""

  if [ -f .claude-multi/state.json ]; then
    # Parse JSON (requires jq, but fallback to cat if not available)
    if command -v jq &> /dev/null; then
      STATUS=$(jq -r '.status' .claude-multi/state.json)
      TOTAL_TASKS=$(jq -r '.metrics.total_tasks' .claude-multi/state.json)
      COMPLETED=$(jq -r '.metrics.completed_tasks' .claude-multi/state.json)
      FAILED=$(jq -r '.metrics.failed_tasks' .claude-multi/state.json)
      COST=$(jq -r '.metrics.estimated_cost' .claude-multi/state.json)

      echo "📊 System Status: $STATUS"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "📈 Progress:"
      echo "   Total Tasks: $TOTAL_TASKS"
      echo "   Completed: $COMPLETED"
      echo "   Failed: $FAILED"
      echo "   In Progress: $(jq '.tasks_in_progress | length' .claude-multi/state.json)"
      echo "   Queued: $(jq '.task_queue | length' .claude-multi/state.json)"
      echo ""
      echo "💰 Cost Estimate: £$COST / £200"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "🎯 Orchestrator:"
      ORC_STATUS=$(jq -r '.orchestrator.status' .claude-multi/state.json)
      ORC_ACTION=$(jq -r '.orchestrator.current_action' .claude-multi/state.json)
      echo "   Status: $ORC_STATUS"
      echo "   Action: $ORC_ACTION"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "🤖 Workers:"
      for i in {1..4}; do
        W_STATUS=$(jq -r ".workers.\"worker-$i\".status" .claude-multi/state.json)
        W_TASK=$(jq -r ".workers.\"worker-$i\".current_task" .claude-multi/state.json)
        W_COMPLETED=$(jq -r ".workers.\"worker-$i\".tasks_completed" .claude-multi/state.json)
        echo "   Worker $i: $W_STATUS | Task: $W_TASK | Completed: $W_COMPLETED"
      done
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "🚨 Recent Errors:"
      jq -r '.errors[-3:] | .[] | "   - " + .' .claude-multi/state.json 2>/dev/null || echo "   None"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "✅ Recently Completed:"
      jq -r '.tasks_completed[-3:] | .[] | "   - " + .title' .claude-multi/state.json 2>/dev/null || echo "   None yet"

    else
      echo "⚠️  Install 'jq' for formatted dashboard: npm install -g jq"
      echo ""
      cat .claude-multi/state.json | head -50
    fi
  else
    echo "⚠️  No state.json found. Have you started the orchestrator?"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Last updated: $(date)"
  echo "Press Ctrl+C to exit"

  sleep 5
done
