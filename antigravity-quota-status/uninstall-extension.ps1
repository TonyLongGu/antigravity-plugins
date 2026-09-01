<#
.SYNOPSIS
    Antigravity IDE 單一擴充套件一鍵卸載腳本
#>
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$sourceDir = $PSScriptRoot

$pkgJsonPath = Join-Path $sourceDir "package.json"
$extPublisher = "antigravity-toolkit"
$extName = "antigravity-custom-tool"
$extVersion = "1.0.0"
$displayName = $extName

if (Test-Path -LiteralPath $pkgJsonPath) {
    try {
        $pkg = Get-Content -LiteralPath $pkgJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pkg.publisher) { $extPublisher = $pkg.publisher }
        if ($pkg.name) { $extName = $pkg.name }
        if ($pkg.version) { $extVersion = $pkg.version }
        if ($pkg.displayName) { $displayName = $pkg.displayName }
    } catch {}
}

$fullExtId = "$extPublisher.$extName"
$baseRoots = @((Join-Path $env:USERPROFILE ".antigravity-ide\extensions"), (Join-Path $env:USERPROFILE ".antigravity\extensions"))

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  解除安裝 Antigravity 原生擴充套件      " -ForegroundColor Cyan
Write-Host "  套件: $displayName ($fullExtId)       " -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

foreach ($baseRoot in $baseRoots) {
    if (-not (Test-Path -LiteralPath $baseRoot)) { continue }

    # 1. 萬用字元徹底刪除 Junction 與實體資料夾
    $existingDiskItems = @(Get-ChildItem -LiteralPath $baseRoot)
    foreach ($diskItem in $existingDiskItems) {
        $diname = $diskItem.Name
        if ($diname -like "$fullExtId*" -or $diname -like "$extName*" -or $diname -like "antigravity-toolkit.$extName*") {
            try {
                $item = Get-Item -LiteralPath $diskItem.FullName -Force
                if ($item.LinkType -eq "Junction" -or $item.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
                    $item.Delete()
                } else {
                    Remove-Item -LiteralPath $diskItem.FullName -Recurse -Force
                }
                Write-Host "[OK] 已移除連結: $($diskItem.FullName)" -ForegroundColor Green
            } catch {
                cmd.exe /c "rd /s /q `"$($diskItem.FullName)`"" 2>$null
            }
        }
    }

    # 2. 清理 .obsolete 殘留 (無 BOM UTF-8)
    $obsoletePath = Join-Path $baseRoot ".obsolete"
    if (Test-Path -LiteralPath $obsoletePath) {
        try {
            $json = Get-Content -LiteralPath $obsoletePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $changed = $false
            $propNames = @($json.PSObject.Properties | ForEach-Object { $_.Name })
            foreach ($pn in $propNames) {
                if ($pn -like "$fullExtId*" -or $pn -like "$extName*" -or $pn -like "antigravity-toolkit.$extName*") {
                    $json.PSObject.Properties.Remove($pn)
                    $changed = $true
                }
            }
            if ($changed) {
                $remainingProps = @($json.PSObject.Properties).Count
                if ($remainingProps -eq 0) {
                    Remove-Item -LiteralPath $obsoletePath -Force
                } else {
                    $obsoleteText = $json | ConvertTo-Json -Compress
                    [System.IO.File]::WriteAllText($obsoletePath, $obsoleteText, $utf8NoBom)
                }
            }
        } catch {
            Remove-Item -LiteralPath $obsoletePath -Force -ErrorAction SilentlyContinue
        }
    }

    # 3. 從 extensions.json 移除註冊紀錄 (頂層陣列 + 無 BOM UTF-8)
    $jsonPath = Join-Path $baseRoot "extensions.json"
    if (Test-Path -LiteralPath $jsonPath) {
        try {
            $raw = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8
            if ($raw -and $raw.Trim()) {
                if ($raw.Length -gt 0 -and [int]$raw[0] -eq 65279) {
                    $raw = $raw.Substring(1)
                }
                $parsed = $raw | ConvertFrom-Json
                $entries = if ($parsed.PSObject.Properties['value']) { $parsed.value } else { $parsed }
                $filtered = [System.Collections.ArrayList]::new()
                $found = $false
                foreach ($entry in $entries) {
                    $eid = if ($entry.identifier) { $entry.identifier.id } else { "" }
                    if ($eid -ne $fullExtId -and $eid -ne $extName -and $eid -ne "antigravity-toolkit.$extName") {
                        [void]$filtered.Add($entry)
                    } else {
                        $found = $true
                    }
                }
                if ($found) {
                    $jsonText = ConvertTo-Json -InputObject $filtered.ToArray() -Depth 10
                    [System.IO.File]::WriteAllText($jsonPath, $jsonText, $utf8NoBom)
                    Write-Host "[OK] 已從清單取消註冊: $jsonPath" -ForegroundColor Green
                }
            }
        } catch {
            Write-Host "[WARN] Skip extensions.json cleanup: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "擴充套件卸載完成！請於 IDE 按 [Ctrl + Shift + P] -> 執行 [Developer: Reload Window] 生效。" -ForegroundColor Green
