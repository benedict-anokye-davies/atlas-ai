#!/bin/bash
# monitor.sh - Monitor Nova build progress
# Run in a separate terminal while auto-build.sh runs

clear

echo "═══════════════════════════════════════════════════════════"
echo "  NOVA BUILD MONITOR"
echo "  Press Ctrl+C to exit"
echo "═══════════════════════════════════════════════════════════"
echo ""

while true; do
    clear
    
    echo "═══════════════════════════════════════════════════════════"
    echo "  NOVA BUILD MONITOR - $(date '+%Y-%m-%d %H:%M:%S')"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    
    # Git status
    echo "📊 GIT STATUS:"
    echo "─────────────────────────────────────────────────────────────"
    git log --oneline 2>/dev/null | head -10 || echo "No commits yet"
    echo ""
    
    # Task progress
    echo "📋 TASK PROGRESS:"
    echo "─────────────────────────────────────────────────────────────"
    if [ -f PRD.md ]; then
        complete=$(grep -c "\[x\]" PRD.md 2>/dev/null || echo "0")
        incomplete=$(grep -c "\[ \]" PRD.md 2>/dev/null || echo "0")
        total=$((complete + incomplete))
        if [ $total -gt 0 ]; then
            percent=$((complete * 100 / total))
            echo "Complete: $complete / $total ($percent%)"
            
            # Progress bar
            filled=$((percent / 5))
            empty=$((20 - filled))
            printf "["
            printf "%${filled}s" | tr ' ' '█'
            printf "%${empty}s" | tr ' ' '░'
            printf "] $percent%%\n"
        fi
    else
        echo "PRD.md not found"
    fi
    echo ""
    
    # Recent progress
    echo "📝 RECENT PROGRESS:"
    echo "─────────────────────────────────────────────────────────────"
    if [ -f progress.txt ]; then
        tail -15 progress.txt
    else
        echo "progress.txt not found"
    fi
    echo ""
    
    # Build log (if exists)
    if [ -f build.log ]; then
        echo "📄 BUILD LOG (last 5 lines):"
        echo "─────────────────────────────────────────────────────────────"
        tail -5 build.log
        echo ""
    fi
    
    # Test status
    if [ -f package.json ]; then
        echo "🧪 TEST STATUS:"
        echo "─────────────────────────────────────────────────────────────"
        npm run test --silent 2>/dev/null && echo "✅ Tests passing" || echo "❌ Tests failing or not set up yet"
        echo ""
    fi
    
    echo "─────────────────────────────────────────────────────────────"
    echo "Refreshing in 10 seconds... (Ctrl+C to exit)"
    
    sleep 10
done
