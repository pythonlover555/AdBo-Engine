@echo off
REM ============================================================
REM  Launch Chrome with every *-extension folder in this repo.
REM  Extensions auto-start their navigation loop on browser open.
REM  Run start_server.bat first — extensions call localhost:8137.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=8137"
set "PROFILE=%~dp0.chrome-profile"
set "EXT_PATHS="
set "EXT_COUNT=0"

REM --- Collect unpacked extension directories -------------------
for /d %%D in ("%~dp0*-extension") do (
    if exist "%%D\manifest.json" (
        set /a EXT_COUNT+=1
        if defined EXT_PATHS (
            set "EXT_PATHS=!EXT_PATHS!,%%~fD"
        ) else (
            set "EXT_PATHS=%%~fD"
        )
        echo [info] Extension !EXT_COUNT!: %%~nxD
    )
)

if !EXT_COUNT! equ 0 (
    echo [ERROR] No *-extension folders with manifest.json found in "%~dp0"
    echo.
    pause
    exit /b 1
)

REM --- Locate Chrome --------------------------------------------
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME (
    for /f "delims=" %%C in ('where chrome 2^>nul') do (
        if not defined CHROME set "CHROME=%%C"
    )
)

if not defined CHROME (
    echo [ERROR] Google Chrome not found. Install Chrome or add chrome.exe to PATH.
    echo.
    pause
    exit /b 1
)

REM --- Warn if the local server is not listening ------------------
set "SERVER_UP=0"
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    set "SERVER_UP=1"
)
if "!SERVER_UP!"=="0" (
    echo [warn] Nothing is listening on port %PORT%. Start the server first:
    echo        start_server.bat
    echo.
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo [info] Chrome: %CHROME%
echo [info] Profile: %PROFILE%
echo [info] Loading !EXT_COUNT! extension(s) — auto-start polls while not running (~10s).
echo.

start "" "%CHROME%" --user-data-dir="%PROFILE%" --load-extension="%EXT_PATHS%"

echo [info] Chrome launched. Close this window when done.
ping 127.0.0.1 -n 3 >nul

endlocal
