@echo off
REM Start a Worker Claude (Terminals 2-5)

if "%1"=="" (
  echo Usage: start-worker.bat [worker-number]
  echo Example: start-worker.bat 1
  exit /b 1
)

set WORKER_ID=%1

echo ============================================
echo   NOVA WORKER CLAUDE #%WORKER_ID%
echo ============================================
echo.
echo This Claude will execute tasks from the queue.
echo.
echo Instructions for Claude Code:
echo 1. Read .claude-multi/WORKER_PROMPT.md
echo 2. Replace {N} with %WORKER_ID% everywhere
echo 3. Follow the workflow loop
echo 4. Claim tasks from state.json
echo.
echo Press Ctrl+C to stop this worker.
echo.
echo ============================================
echo.

REM Set git branch
set BRANCH=worker-%WORKER_ID%
git checkout -b %BRANCH% 2>nul
if errorlevel 1 git checkout %BRANCH%
git push -u origin %BRANCH% 2>nul

echo.
echo Branch ready: %BRANCH%
echo.
echo ============================================
echo   COPY THIS PROMPT TO CLAUDE CODE:
echo ============================================
echo.

REM Output worker prompt with ID replaced
powershell -Command "(Get-Content .claude-multi\WORKER_PROMPT.md) -replace '{N}', '%WORKER_ID%' | Write-Output"
