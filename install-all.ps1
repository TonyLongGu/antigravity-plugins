<#
.SYNOPSIS
    Antigravity IDE Native Extensions Suite - 1-Click Batch Installation Script
#>
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Google Antigravity IDE Native Extensions - Install All" -ForegroundColor Cyan
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
        Write-Host "[Installing] $($dir.Name) ..." -ForegroundColor Yellow
        try {
            & $installPs1
            if ($LASTEXITCODE -eq 0 -or $? -eq $true) {
                $success++
            }
        } catch {
            Write-Host "[Error] Failed to install $($dir.Name): $_" -ForegroundColor Red
        }
    } elseif (Test-Path -LiteralPath $installBat) {
        $total++
        Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "[Installing] $($dir.Name) ..." -ForegroundColor Yellow
        & cmd.exe /c "`"$installBat`""
        if ($LASTEXITCODE -eq 0) {
            $success++
        }
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($total -gt 0 -and $success -eq $total) {
    Write-Host "  [Success] Installation complete! Successfully installed: $success / $total extensions." -ForegroundColor Green
} else {
    Write-Host "  [Info] Installation finished: $success / $total extensions installed." -ForegroundColor Yellow
}
Write-Host "  In Antigravity IDE, press [Ctrl + Shift + P] and run:" -ForegroundColor White
Write-Host "  Developer: Reload Window to activate immediately!" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
