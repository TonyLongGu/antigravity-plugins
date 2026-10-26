<#
.SYNOPSIS
    單套件卸載入口（薄殼）— 實際邏輯在根目錄 uninstall-all.ps1

.DESCRIPTION
    2026-10-26 起，6 個外掛自帶的 uninstall-extension.ps1 不再各自複製一份清理邏輯
    （原本 6 份彼此只差 4 行，卻得人工同步）。本檔改為薄殼：
    只把自己的資料夾名稱當 -Plugin 傳給根目錄 uninstall-all.ps1，
    因此「單套件卸載」與「全套卸載」永遠走同一份程式，不會再各自漂移。

    -Target 直接透傳（預設 Prompt＝互動選單，與改版前行為相同）。

.NOTES
    必須與根目錄 uninstall-all.ps1 保持相對位置（整個 repo 一起搬移沒問題，
    單獨複製本資料夾會失效）。
#>
[CmdletBinding()]
param (
    [ValidateSet("Antigravity", "VSCode", "Cursor", "All", "Prompt")]
    [string]$Target = "Prompt"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$pluginName = Split-Path -Leaf $PSScriptRoot
$rootScript = Join-Path (Split-Path -Parent $PSScriptRoot) "uninstall-all.ps1"

if (-not (Test-Path -LiteralPath $rootScript)) {
    Write-Host "[錯誤] 找不到根目錄的 uninstall-all.ps1：$rootScript" -ForegroundColor Red
    Write-Host "       本檔是薄殼入口，需與根目錄腳本放在同一個 repo（請勿單獨複製本資料夾）。" -ForegroundColor Yellow
    Exit 1
}

$global:LASTEXITCODE = 0
try {
    & $rootScript -Target $Target -Plugin $pluginName
} catch {
    Write-Host "[錯誤] 卸載失敗：$($_.Exception.Message)" -ForegroundColor Red
    Exit 1
}

Exit [int]$global:LASTEXITCODE
