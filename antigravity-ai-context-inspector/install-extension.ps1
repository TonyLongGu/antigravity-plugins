<#
.SYNOPSIS
    IDE 擴充套件一鍵安裝腳本 (智慧偵測 Antigravity IDE 與 VS Code + Junction 免編譯掛載 + extensions.json 註冊)
#>
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$sourceDir = $PSScriptRoot

# 動態讀取 package.json 資訊
$pkgJsonPath = Join-Path $sourceDir "package.json"
$extPublisher = "antigravity-toolkit"
$extName = "antigravity-ai-context-inspector"
$extVersion = "1.1.7"
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
$standardFolderName = "$fullExtId-$extVersion"

# 智慧偵測本機支援之 IDE 環境
$candidateTargets = @(
    [PSCustomObject]@{
        Name = "VS Code"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode"),
            (Join-Path $env:APPDATA "Code")
        )
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode\extensions")
    },
    [PSCustomObject]@{
        Name = "VS Code Insiders"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode-insiders"),
            (Join-Path $env:APPDATA "Code - Insiders")
        )
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode-insiders\extensions")
    },
    [PSCustomObject]@{
        Name = "Antigravity IDE"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity-ide"),
            (Join-Path $env:APPDATA "Antigravity IDE")
        )
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity-ide\extensions")
    },
    [PSCustomObject]@{
        Name = "Antigravity (相容路徑)"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity")
        )
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity\extensions")
    }
)

$targetEnvironments = @()
foreach ($c in $candidateTargets) {
    $matched = $false
    foreach ($cp in $c.CheckPaths) {
        if (Test-Path -LiteralPath $cp) {
            $matched = $true
            break
        }
    }
    if (-not $matched -and (Test-Path -LiteralPath $c.ExtensionsRoot)) {
        $matched = $true
    }
    if ($matched) {
        $targetEnvironments += $c
    }
}

if ($targetEnvironments.Count -eq 0) {
    $targetEnvironments += $candidateTargets[0]
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安裝 IDE 原生擴充套件 (雙環境相容)     " -ForegroundColor Cyan
Write-Host "  套件名稱: $displayName                " -ForegroundColor Yellow
Write-Host "  套件識別: $fullExtId (v$extVersion)    " -ForegroundColor Gray
Write-Host "  偵測環境: $(($targetEnvironments | ForEach-Object { $_.Name }) -join ', ') " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

$successCount = 0

foreach ($envTarget in $targetEnvironments) {
    $baseRoot = $envTarget.ExtensionsRoot
    $envName = $envTarget.Name
    Write-Host "`n>> 正在部署至 [$envName]..." -ForegroundColor Cyan

    if (-not (Test-Path -LiteralPath $baseRoot)) {
        New-Item -ItemType Directory -Path $baseRoot -Force | Out-Null
    }

    # 1. 萬用字元徹底清理舊目錄與 Junction (包含歷史版本)
    if (Test-Path -LiteralPath $baseRoot) {
        $existingDiskItems = @(Get-ChildItem -LiteralPath $baseRoot)
        foreach ($diskItem in $existingDiskItems) {
            $diname = $diskItem.Name
            $shouldDelete = $false
            if ($diname -like "$fullExtId*" -or $diname -like "$extName*" -or $diname -like "antigravity-toolkit.$extName*") {
                if ($diname.StartsWith("antigravity-toolkit.") -or $diname.StartsWith("antigravity-ai-context-inspector") -or $diname.StartsWith("antigravity-")) {
                    $shouldDelete = $true
                }
            }

            if ($shouldDelete) {
                try {
                    $item = Get-Item -LiteralPath $diskItem.FullName -Force
                    if ($item.LinkType -eq "Junction" -or $item.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
                        $item.Delete()
                    } else {
                        Remove-Item -LiteralPath $diskItem.FullName -Recurse -Force
                    }
                } catch {
                    cmd.exe /c "rd /s /q `"$($diskItem.FullName)`"" 2>$null
                }
            }
        }
    }

    # 2. 建立標準 Junction 連結
    $targetPath = Join-Path $baseRoot $standardFolderName
    try {
        New-Item -ItemType Junction -Path $targetPath -Target $sourceDir -ErrorAction Stop | Out-Null
        Write-Host "  [成功] 已建立連結: $targetPath" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "  [失敗] 無法建立連結 $targetPath : $_" -ForegroundColor Red
        continue
    }

    # 3. 清除 .obsolete 中的廢棄標記 (無 BOM UTF-8)
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

    # 4. 註冊至 extensions.json (頂層 Array 格式 + source: local metadata + 無 BOM UTF-8)
    $jsonPath = Join-Path $baseRoot "extensions.json"
    try {
        $existingItems = [System.Collections.ArrayList]::new()
        if (Test-Path -LiteralPath $jsonPath) {
            $raw = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8
            if ($raw -and $raw.Trim()) {
                if ($raw.Length -gt 0 -and [int]$raw[0] -eq 65279) {
                    $raw = $raw.Substring(1)
                }
                $parsed = $raw | ConvertFrom-Json
                $entries = if ($parsed.PSObject.Properties['value']) { $parsed.value } else { $parsed }
                foreach ($entry in $entries) {
                    $eid = if ($entry.identifier) { $entry.identifier.id } else { "" }
                    if ($eid -ne $fullExtId -and $eid -ne $extName -and $eid -ne "antigravity-toolkit.$extName") {
                        [void]$existingItems.Add($entry)
                    }
                }
            }
        }

        $cleanPath = $targetPath.Replace("\", "/")
        if (-not $cleanPath.StartsWith("/")) {
            $cleanPath = "/" + $cleanPath
        }

        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $regItem = [PSCustomObject]@{
            identifier = [PSCustomObject]@{ id = $fullExtId }
            version = $extVersion
            location = [PSCustomObject]@{
                '$mid' = 1
                path = $cleanPath
                scheme = "file"
            }
            relativeLocation = $standardFolderName
            metadata = [PSCustomObject]@{
                isApplicationScoped = $false
                installedTimestamp = $nowMs
                pinned = $false
                source = "local"
                id = $fullExtId
                publisherId = $extPublisher
                publisherDisplayName = $extPublisher
                targetPlatform = "universal"
                updated = $false
                private = $false
                isPreReleaseVersion = $false
                hasPreReleaseVersion = $false
            }
        }
        [void]$existingItems.Add($regItem)

        $jsonText = ConvertTo-Json -InputObject $existingItems.ToArray() -Depth 10
        [System.IO.File]::WriteAllText($jsonPath, $jsonText, $utf8NoBom)
        Write-Host "  [成功] 已註冊至擴充清單: $jsonPath" -ForegroundColor Green
    } catch {
        Write-Host "  [提示] extensions.json 註冊略過: $($_.Exception.Message)" -ForegroundColor Gray
    }
}

Write-Host ""
if ($successCount -gt 0) {
    Write-Host "擴充套件安裝成功！請於 Antigravity IDE 或 VS Code 按 [Ctrl + Shift + P] -> 執行 [Developer: Reload Window] 生效。" -ForegroundColor Green
}
