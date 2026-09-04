<#
.SYNOPSIS
    Antigravity IDE Native Extensions Suite - 1-Click Batch Uninstallation Script
#>
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Google Antigravity IDE Native Extensions - Uninstall All" -ForegroundColor Cyan
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
        Write-Host "[Uninstalling] $($dir.Name) ..." -ForegroundColor Yellow
        try {
            & $uninstallPs1
            if ($LASTEXITCODE -eq 0 -or $? -eq $true) {
                $success++
            }
        } catch {
            Write-Host "[Error] Failed to uninstall $($dir.Name): $_" -ForegroundColor Red
        }
    } elseif (Test-Path -LiteralPath $uninstallBat) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[Uninstalling] $($dir.Name) ..." -ForegroundColor Yellow
        & cmd.exe /c "`"$uninstallBat`""
        if ($LASTEXITCODE -eq 0) {
            $success++
        }
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($total -gt 0 -and $success -eq $total) {
    Write-Host "  [Success] Uninstallation complete! Cleaned up: $success / $total extensions." -ForegroundColor Green
} else {
    Write-Host "  [Info] Uninstallation finished: $success / $total extensions cleaned up." -ForegroundColor Yellow
}
Write-Host "  In Antigravity IDE, press [Ctrl + Shift + P] and run:" -ForegroundColor White
Write-Host "  Developer: Reload Window to apply changes." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
