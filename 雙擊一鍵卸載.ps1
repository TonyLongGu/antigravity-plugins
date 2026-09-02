<#
.SYNOPSIS
    Antigravity IDE 全套原生擴充套件 - 一鍵批量卸載腳本
#>
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Google Antigravity IDE 原生擴充套件 - 全套一鍵卸載   " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$subDirs = Get-ChildItem -LiteralPath $rootDir -Directory | Sort-Object Name
$total = 0
$success = 0

foreach ($dir in $subDirs) {
    $uninstallPs1 = Join-Path $dir.FullName "uninstall-extension.ps1"
    $uninstallBat = Join-Path $dir.FullName "uninstall-extension.bat"
    
    if (Test-Path -LiteralPath $uninstallPs1) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[正在卸載] $($dir.Name) ..." -ForegroundColor Yellow
        try {
            & $uninstallPs1
            if ($LASTEXITCODE -eq 0 -or $? -eq $true) {
                $success++
            }
        } catch {
            Write-Host "[錯誤] 卸載 $($dir.Name) 失敗: $_" -ForegroundColor Red
        }
    } elseif (Test-Path -LiteralPath $uninstallBat) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[正在卸載] $($dir.Name) ..." -ForegroundColor Yellow
        & cmd.exe /c "`"$uninstallBat`""
        if ($LASTEXITCODE -eq 0) {
            $success++
        }
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($total -gt 0 -and $success -eq $total) {
    Write-Host "  [成功] 全套卸載完成！已清理: $success / $total 個擴充套件" -ForegroundColor Green
} else {
    Write-Host "  [提示] 卸載完成：已清理 $success / 共 $total 個擴充套件" -ForegroundColor Yellow
}
Write-Host "  請在 Antigravity IDE 按 [Ctrl + Shift + P] 執行:" -ForegroundColor White
Write-Host "  Developer: Reload Window 即可生效。" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
