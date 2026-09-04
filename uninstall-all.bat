@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dpn0.ps1" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo Script execution failed with Exit Code: %ERRORLEVEL%
)

echo.
pause
endlocal
