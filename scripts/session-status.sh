#!/bin/bash
# session-status.sh - View all active Nova development sessions

echo "═══════════════════════════════════════════════════════════"
echo "  NOVA DEVELOPMENT SESSIONS"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check for session files
if [ -d ".sessions" ]; then
    for f in .sessions/terminal-*.json; do
        if [ -f "$f" ]; then
            terminal=$(cat "$f" | grep -o '"terminal": [0-9]*' | grep -o '[0-9]*')
            status=$(cat "$f" | grep -o '"status": "[^"]*"' | cut -d'"' -f4)
            task=$(cat "$f" | grep -o '"currentTask": "[^"]*"' | cut -d'"' -f4)
            updated=$(cat "$f" | grep -o '"lastUpdated": "[^"]*"' | cut -d'"' -f4)
            
            if [ "$status" == "ACTIVE" ]; then
                echo "  ✅ Terminal $terminal: $task"
            else
                echo "  ⬚ Terminal $terminal: $status"
            fi
            echo "     Last updated: $updated"
            echo ""
        fi
    done
else
    echo "  No active sessions found."
fi

echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Commands:"
echo "  Start session: Tell OpenCode 'I am Terminal N, register me'"
echo "  Check status:  ./scripts/session-status.sh"
echo "  View locks:    cat .sessions/terminal-*.json"
