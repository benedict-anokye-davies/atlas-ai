@echo off
REM Start the Orchestrator Claude (Terminal 1)

echo ============================================
echo   NOVA MULTI-CLAUDE ORCHESTRATOR
echo ============================================
echo.
echo This Claude will coordinate 4 worker Claudes.
echo.
echo Instructions for Claude Code:
echo 1. Read .claude-multi/ORCHESTRATOR_PROMPT.md
echo 2. Follow the workflow loop
echo 3. Manage workers via state.json
echo.
echo Press Ctrl+C to stop the orchestrator.
echo.
echo ============================================
echo.

REM Set git branch
git checkout -b orchestrator 2>nul
if errorlevel 1 git checkout orchestrator

REM Initialize state
powershell -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')" > .claude-multi\timestamp.tmp
set /p TIMESTAMP=<.claude-multi\timestamp.tmp
del .claude-multi\timestamp.tmp

echo {"session_id": "nova-parallel-001", "started_at": "%TIMESTAMP%", "status": "active", "orchestrator": {"status": "initializing", "last_update": "%TIMESTAMP%", "current_action": "Reading project documentation"}, "workers": {"worker-1": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-1"}, "worker-2": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-2"}, "worker-3": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-3"}, "worker-4": {"status": "waiting", "current_task": null, "last_update": null, "tasks_completed": 0, "branch": "worker-4"}}, "task_queue": [], "tasks_in_progress": [], "tasks_completed": [], "tasks_failed": [], "errors": [], "metrics": {"total_tasks": 0, "completed_tasks": 0, "failed_tasks": 0, "total_commits": 0, "estimated_cost": 0}} > .claude-multi\state.json

echo.
echo State initialized successfully!
echo.
echo ============================================
echo   COPY THIS PROMPT TO CLAUDE CODE:
echo ============================================
echo.
type .claude-multi\ORCHESTRATOR_PROMPT.md
