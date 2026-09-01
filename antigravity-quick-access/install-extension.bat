@echo off
chcp 65001 >nul
title Install Antigravity Quick Access Extension
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-extension.ps1"
pause
