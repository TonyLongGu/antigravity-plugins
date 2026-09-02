<#
.SYNOPSIS
    Antigravity IDE 全套原生擴充套件 - 一鍵批量安裝腳本
#>
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Google Antigravity IDE 原生擴充套件 - 全套一鍵安裝   " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$subDirs = Get-ChildItem -LiteralPath $rootDir -Directory | Sort-Object Name
$total = 0
$success = 0

foreach ($dir in $subDirs) {
    $installPs1 = Join-Path $dir.FullName "install-extension.ps1"
    $installBat = Join-Path $dir.FullName "install-extension.bat"
    
    if (Test-Path -LiteralPath $installPs1) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[正在安裝] $($dir.Name) ..." -ForegroundColor Yellow
        try {
            & $installPs1
            if ($LASTEXITCODE -eq 0 -or $? -eq $true) {
                $success++
            }
        } catch {
            Write-Host "[錯誤] 安裝 $($dir.Name) 失敗: $_" -ForegroundColor Red
        }
    } elseif (Test-Path -LiteralPath $installBat) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[正在安裝] $($dir.Name) ..." -ForegroundColor Yellow
        & cmd.exe /c "`"$installBat`""
        if ($LASTEXITCODE -eq 0) {
            $success++
        }
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($total -gt 0 -and $success -eq $total) {
    Write-Host "  [成功] 全套安裝完成！成功安裝: $success / $total 個擴充套件" -ForegroundColor Green
} else {
    Write-Host "  [提示] 安裝完成：成功 $success / 共 $total 個擴充套件" -ForegroundColor Yellow
}
Write-Host "  請在 Antigravity IDE 按 [Ctrl + Shift + P] 執行:" -ForegroundColor White
Write-Host "  Developer: Reload Window 即可立即啟用！" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
