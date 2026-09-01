@echo off
chcp 65001 >nul
title Antigravity 原生擴充套件 - 全套一鍵安裝
cd /d "%~dp0"

echo ========================================================
echo    Google Antigravity IDE 原生擴充套件 - 全套一鍵安裝
echo ========================================================
echo.

set "TOTAL=0"
set "SUCCESS=0"

for /d %%D in (*) do (
    if exist "%%D\install-extension.bat" (
        set /a TOTAL+=1
        echo [安裝中] %%D ...
        call "%%D\install-extension.bat"
        if not errorlevel 1 (
            set /a SUCCESS+=1
        )
        echo --------------------------------------------------------
    )
)

echo.
echo ========================================================
echo   安裝完成！成功安裝: %SUCCESS% / %TOTAL% 個擴充套件
echo   請在 Antigravity IDE 按 Ctrl+Shift+P 執行:
echo   Developer: Reload Window 即可立即啟用！
echo ========================================================
echo.
pause
