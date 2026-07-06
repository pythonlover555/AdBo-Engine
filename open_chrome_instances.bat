@echo off
REM ============================================================
REM  Open Chrome profiles simultaneously (each in a new window).
REM  Profile numbers are read from ProfileList.txt (comma-separated).
REM  Extensions auto-start via a ~10s poll while not running.
REM  Run start_server.bat first — extensions call localhost:8137.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PROFILE_LIST_FILE=%~dp0ProfileList.txt"
set "PROFILE_LIST="
set "PORT=8137"
set "USER_DATA=%LOCALAPPDATA%\Google\Chrome\User Data"

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
    echo [ERROR] Google Chrome not found.
    pause
    exit /b 1
)

if not exist "%USER_DATA%" (
    echo [ERROR] Chrome user data not found at:
    echo   "%USER_DATA%"
    pause
    exit /b 1
)

if not exist "%PROFILE_LIST_FILE%" (
    echo [ERROR] Profile list not found:
    echo   "%PROFILE_LIST_FILE%"
    pause
    exit /b 1
)
for /f "usebackq delims=" %%L in ("%PROFILE_LIST_FILE%") do set "PROFILE_LIST=%%L"
if not defined PROFILE_LIST (
    echo [ERROR] ProfileList.txt is empty.
    pause
    exit /b 1
)
REM Comma-separated numbers in ProfileList.txt -> space-separated for "for".
set "PROFILE_LIST=!PROFILE_LIST:,= !"

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

echo [info] Chrome: %CHROME%
echo [info] User data: %USER_DATA%
echo [info] Profiles: ProfileList.txt  ^(simultaneous, new window each^)
echo [info] Profile list: %PROFILE_LIST_FILE%
echo [info] Extensions auto-start via poll while not running (~10s)
echo.

for %%i in (!PROFILE_LIST!) do (
    set "PROFILE_NAME=Profile %%i"
    if not exist "%USER_DATA%\!PROFILE_NAME!" (
        echo [warn] !PROFILE_NAME! folder not found — Chrome may create it on first open
    )
    echo [info] Launching !PROFILE_NAME! ...
    REM --new-window forces a real window-open event so the extension auto-starts
    REM even when this profile already had a window from a previous execute.bat run.
    start "" "%CHROME%" --user-data-dir="%USER_DATA%" --profile-directory="!PROFILE_NAME!" --new-window
)

echo.
echo [info] Done. All profiles launched — extensions poll until started (~10s).
ping 127.0.0.1 -n 3 >nul
endlocal
