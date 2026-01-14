@echo off
echo ============================================
echo   NOVA MULTI-CLAUDE SYSTEM LAUNCHER
echo ============================================
echo.
echo This will open 5 Claude Code terminals.
echo.
echo Press any key to start, or Ctrl+C to cancel.
pause >nul

echo.
echo Starting orchestrator in new window...
start "Nova Orchestrator" cmd /k "cd /d %~dp0.. && .claude-multi\start-orchestrator.bat"

timeout /t 2 /nobreak >nul

echo Starting worker 1 in new window...
start "Nova Worker 1" cmd /k "cd /d %~dp0.. && .claude-multi\start-worker.bat 1"

timeout /t 1 /nobreak >nul

echo Starting worker 2 in new window...
start "Nova Worker 2" cmd /k "cd /d %~dp0.. && .claude-multi\start-worker.bat 2"

timeout /t 1 /nobreak >nul

echo Starting worker 3 in new window...
start "Nova Worker 3" cmd /k "cd /d %~dp0.. && .claude-multi\start-worker.bat 3"

timeout /t 1 /nobreak >nul

echo Starting worker 4 in new window...
start "Nova Worker 4" cmd /k "cd /d %~dp0.. && .claude-multi\start-worker.bat 4"

echo.
echo ============================================
echo   ALL TERMINALS LAUNCHED!
echo ============================================
echo.
echo Next steps:
echo 1. In each window, copy the displayed prompt
echo 2. Open Claude Code in that window
echo 3. Paste the prompt and hit Enter
echo 4. Watch the magic happen!
echo.
echo Optional: Start monitor in this window with:
echo   type .claude-multi\state.json
echo.
echo Press any key to close this launcher...
pause >nul
