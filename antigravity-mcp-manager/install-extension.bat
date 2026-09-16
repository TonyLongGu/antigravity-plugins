@echo off
chcp 65001 >nul
title Install Extension
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dpn0.ps1" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo 腳本執行失敗，結束代碼: %ERRORLEVEL%
    pause
)
endlocal
