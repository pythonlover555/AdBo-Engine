@echo off
REM ============================================================
REM  Command every open Chrome browser's nav-extension to start.
REM  Idle instances start within ~10s; already-running ones are
REM  left alone. Requires start_server.bat / run_server.py to be
REM  running first.
REM ============================================================
setlocal
set "PORT=8137"

curl -X POST "http://localhost:%PORT%/api/trigger-start"
echo.

pause
endlocal
