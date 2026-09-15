@echo off
chcp 65001 >nul
title Install Quick Access Extension (Antigravity IDE)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-extension.ps1"
pause
