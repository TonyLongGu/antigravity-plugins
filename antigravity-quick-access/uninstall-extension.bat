@echo off
chcp 65001 >nul
title Uninstall Antigravity Quick Access Extension
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-extension.ps1"
pause
