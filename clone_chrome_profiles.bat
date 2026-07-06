@echo off
setlocal enabledelayedexpansion

set "SOURCE=D:\Chrome_Profile"
set "DEST_ROOT=C:\Users\com\AppData\Local\Google\Chrome\User Data"
set "PROFILES=29 41 42 43 44 45 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148"

echo ============================================
echo Chrome Profile Overlay Copy
echo Source:            %SOURCE%
echo Destination root:  %DEST_ROOT%
echo Mode:              overlay copy (destination-only files are kept)
echo ============================================
echo.

if not exist "%SOURCE%" (
    echo ERROR: Source folder not found: %SOURCE%
    pause
    exit /b 1
)

tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
if not errorlevel 1 (
    echo WARNING: Chrome appears to be running.
    echo Copying into profile folders while Chrome is open can fail or corrupt
    echo data ^(locked files such as the SQLite databases and the LOCK file^).
    echo Please close all Chrome windows now.
    echo.
    choice /M "Continue anyway"
    if errorlevel 2 (
        echo Aborted by user.
        exit /b 1
    )
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%i"

set "BACKUP_ROOT=%DEST_ROOT%\_ProfileBackups\%TIMESTAMP%"
set "LOGFILE=%~dp0clone_chrome_profiles_%TIMESTAMP%.log"

echo Backups will be stored under: %BACKUP_ROOT%
echo Log file: %LOGFILE%
echo.

set /a COPIED=0
set /a SKIPPED=0
set /a BACKED_UP=0

for %%N in (%PROFILES%) do (
    set "PROFILE_DIR=%DEST_ROOT%\Profile %%N"
    if exist "!PROFILE_DIR!" (
        echo [Profile %%N] Found. Backing up, then copying...
        robocopy "!PROFILE_DIR!" "%BACKUP_ROOT%\Profile %%N" /E /COPYALL /R:1 /W:1 /NFL /NDL /NJH /NJS >> "%LOGFILE%" 2>&1
        set /a BACKED_UP+=1

        robocopy "%SOURCE%" "!PROFILE_DIR!" /E /R:1 /W:1 /NFL /NDL /NJH /NJS >> "%LOGFILE%" 2>&1
        set /a COPIED+=1
        echo [Profile %%N] Done.
    ) else (
        echo [Profile %%N] SKIPPED - folder does not exist.
        echo [Profile %%N] SKIPPED - folder does not exist. >> "%LOGFILE%"
        set /a SKIPPED+=1
    )
)

echo.
echo ============================================
echo Summary: !COPIED! copied, !BACKED_UP! backed up, !SKIPPED! skipped
echo Backups:  %BACKUP_ROOT%
echo Full log: %LOGFILE%
echo ============================================
pause
