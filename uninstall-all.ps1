<#
.SYNOPSIS
    IDE 原生擴充套件 - 全套一鍵解除安裝程式
    支援環境嚴格隔離、目標指定 (-Target)、僅清理所選 IDE 之 Junction 與 extensions.json
#>
[CmdletBinding()]
param (
    [ValidateSet("Antigravity", "VSCode", "Cursor", "All", "Prompt")]
    [string]$Target = "Prompt"
)

$ErrorActionPreference = "Stop"

# ── 共用工具：本腳本專用 ─────────────────────────────────────────────
# 判斷資料夾 / .obsolete 鍵名是否為「本套件自身」的安裝產物：
# 僅接受「完整識別碼」或「歷史別名 + 純版本號後綴」，杜絕誤刪市集中同名前綴之其他套件。
function Test-IsOwnExtensionArtifact {
    param(
        [string]$Name,
        [string]$FullExtId,
        [string]$ExtName
    )

    if ([string]::IsNullOrWhiteSpace($Name)) { return $false }

    $identities = @($FullExtId, "antigravity-toolkit.$ExtName", $ExtName) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique

    foreach ($identity in $identities) {
        if ($Name -ieq $identity) { return $true }
        if (-not ($Name -like "$identity-*" -or $Name -like "$identity.*")) { continue }
        if ($Name.Substring($identity.Length).TrimStart('-', '.') -match '^\d+(\.\d+)*(-[0-9A-Za-z\.\-]+)?$') { return $true }
    }

    return $false
}

# 偵測指定擴充目錄所屬的 IDE 是否正在執行 (IDE 執行中會於關閉時覆寫 extensions.json 快取)。
function Get-RunningIdeForRoot {
    param([string[]]$ExtensionRoots)

    if (-not $ExtensionRoots) { return @() }

    $processMap = [ordered]@{
        ".vscode-insiders" = "Code - Insiders"
        ".vscode"          = "Code"
        ".vscodium"        = "VSCodium"
        ".cursor"          = "Cursor"
        ".antigravity-ide" = "Antigravity IDE"
        ".antigravity"     = "Antigravity IDE"
    }

    $running = @()
    foreach ($root in $ExtensionRoots) {
        foreach ($key in $processMap.Keys) {
            if ($root -like "*$key*") {
                $procName = $processMap[$key]
                if (-not ($running -contains $procName) -and (Get-Process -Name $procName -ErrorAction SilentlyContinue)) {
                    $running += $procName
                }
                break
            }
        }
    }

    return $running
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$rootDir = $PSScriptRoot
$pluginsDir = if (Test-Path (Join-Path $rootDir "plugins")) { Join-Path $rootDir "plugins" } else { $rootDir }

# 互動模式提示
if ($Target -eq "Prompt") {
    $isInteractive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if ($isInteractive) {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  🗑️ IDE 原生擴充套件 - 全套一鍵解除安裝程式" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  請選擇欲卸載的目標 IDE 環境 (嚴格隔離，絕不影響其他 IDE)：" -ForegroundColor Yellow
        Write-Host "  [1] Google Antigravity IDE (預設推薦)" -ForegroundColor Green
        Write-Host "  [2] Visual Studio Code" -ForegroundColor White
        Write-Host "  [3] Cursor" -ForegroundColor White
        Write-Host "  [4] 全部已安裝的 IDE (All)" -ForegroundColor Magenta
        Write-Host "============================================================" -ForegroundColor Cyan
        $choice = Read-Host "請輸入選項編號 [1-4] (直接按 Enter 為 1)"
        switch ($choice.Trim()) {
            "2" { $Target = "VSCode" }
            "3" { $Target = "Cursor" }
            "4" { $Target = "All" }
            Default { $Target = "Antigravity" }
        }
    } else {
        $Target = "Antigravity"
    }
}

# 候選 IDE 環境擴充套件根目錄定義
$antigravityRoots = @(
    @{ Name = "Antigravity IDE"; Path = (Join-Path $env:USERPROFILE ".antigravity-ide\extensions") },
    @{ Name = "Antigravity (相容路徑)"; Path = (Join-Path $env:USERPROFILE ".antigravity\extensions") }
)

$vscodeRoots = @(
    @{ Name = "VS Code"; Path = (Join-Path $env:USERPROFILE ".vscode\extensions") },
    @{ Name = "VS Code Insiders"; Path = (Join-Path $env:USERPROFILE ".vscode-insiders\extensions") }
)

$cursorRoots = @(
    @{ Name = "Cursor"; Path = (Join-Path $env:USERPROFILE ".cursor\extensions") }
)

$candidateRoots = switch ($Target) {
    "Antigravity" { $antigravityRoots }
    "VSCode"      { $vscodeRoots }
    "Cursor"      { $cursorRoots }
    "All"         { $antigravityRoots + $vscodeRoots + $cursorRoots }
    Default       { $antigravityRoots }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  🗑️ IDE 原生擴充套件 - 全套一鍵解除安裝 ($Target 目標模式)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 僅比對本機實體存在的擴充目錄
$activeRoots = @()
foreach ($targetItem in $candidateRoots) {
    if (Test-Path -LiteralPath $targetItem.Path) {
        $activeRoots += $targetItem
    }
}

if ($activeRoots.Count -eq 0) {
    Write-Host "未偵測到任何已安裝的 [$Target] 擴充套件目錄，系統已保持乾淨。" -ForegroundColor Gray
    Exit 0
}

Write-Host "目標環境: $(($activeRoots | ForEach-Object { $_.Name }) -join ', ') " -ForegroundColor Yellow
$runningIdes = Get-RunningIdeForRoot -ExtensionRoots ($activeRoots | ForEach-Object { $_.Path })
if ($runningIdes.Count -gt 0) {
    Write-Host "[警告] 偵測到目標 IDE 正在執行中：$($runningIdes -join ', ')" -ForegroundColor Yellow
    Write-Host "       建議先完整關閉該 IDE 後再執行本腳本；否則 IDE 關閉時可能覆寫 extensions.json 快取，導致本次變更未生效。" -ForegroundColor Yellow
}
Write-Host "環境隔離: 生效中 (僅清理所選目標，絕不更動其他 IDE 之擴充)" -ForegroundColor DarkGray

$pluginFolders = if (Test-Path -LiteralPath $pluginsDir) {
    Get-ChildItem -LiteralPath $pluginsDir -Directory
} else {
    @()
}

$uninstalledCount = 0
$uninstalledSummary = @()

foreach ($folder in $pluginFolders) {
    $pkgJsonPath = Join-Path $folder.FullName "package.json"
    if (-not (Test-Path -LiteralPath $pkgJsonPath)) {
        continue
    }

    try {
        $pkg = Get-Content -LiteralPath $pkgJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $extName = $pkg.name
        $extPublisher = if ($pkg.publisher) { $pkg.publisher } else { "antigravity-toolkit" }
        $extVersion = if ($pkg.version) { $pkg.version } else { "1.0.0" }
        $displayName = if ($pkg.displayName) { $pkg.displayName } else { $extName }
        $fullExtId = "$extPublisher.$extName"

        Write-Host "`n------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "▶ 正在檢查解除: $displayName ($fullExtId)" -ForegroundColor Yellow

        $cleanedEnvs = @()

        foreach ($targetItem in $activeRoots) {
            $baseRoot = $targetItem.Path
            $envName = $targetItem.Name

            $foundAny = $false

            # 1. 僅刪除該目標目錄下的 Junction 與目錄連接點
            if (Test-Path -LiteralPath $baseRoot) {
                $existingDiskItems = @(Get-ChildItem -LiteralPath $baseRoot)
                foreach ($diskItem in $existingDiskItems) {
                    $diname = $diskItem.Name
                    if (Test-IsOwnExtensionArtifact -Name $diname -FullExtId $fullExtId -ExtName $extName) {
                        try {
                            $item = Get-Item -LiteralPath $diskItem.FullName -Force
                            if ($item.LinkType -eq "Junction" -or $item.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
                                $item.Delete()
                            } else {
                                Remove-Item -LiteralPath $diskItem.FullName -Recurse -Force
                            }
                            $foundAny = $true
                        } catch {
                            cmd.exe /c "rd /s /q `"$($diskItem.FullName)`"" 2>$null
                            $foundAny = $true
                        }
                    }
                }
            }

            # 2. 清理該目標目錄之 .obsolete
            $obsoletePath = Join-Path $baseRoot ".obsolete"
            if (Test-Path -LiteralPath $obsoletePath) {
                try {
                    $obsoleteJson = Get-Content -LiteralPath $obsoletePath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $changed = $false
                    $propNames = @($obsoleteJson.PSObject.Properties | ForEach-Object { $_.Name })
                    foreach ($pn in $propNames) {
                        if (Test-IsOwnExtensionArtifact -Name $pn -FullExtId $fullExtId -ExtName $extName) {
                            $obsoleteJson.PSObject.Properties.Remove($pn)
                            $changed = $true
                        }
                    }
                    if ($changed) {
                        $remainingProps = @($obsoleteJson.PSObject.Properties).Count
                        if ($remainingProps -eq 0) {
                            Remove-Item -LiteralPath $obsoletePath -Force
                        } else {
                            $obsoleteText = $obsoleteJson | ConvertTo-Json -Compress
                            [System.IO.File]::WriteAllText($obsoletePath, $obsoleteText, $utf8NoBom)
                        }
                    }
                } catch {
                    Remove-Item -LiteralPath $obsoletePath -Force -ErrorAction SilentlyContinue
                }
            }

            # 3. 從該目標目錄之 extensions.json 註冊清單移除
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
                        $modified = $false
                        foreach ($entry in $entries) {
                            $eid = if ($entry.identifier) { $entry.identifier.id } else { "" }
                            if ($eid -ne $fullExtId -and $eid -ne $extName -and $eid -ne "antigravity-toolkit.$extName") {
                                [void]$filtered.Add($entry)
                            } else {
                                $modified = $true
                            }
                        }
                        if ($modified) {
                            $jsonText = ConvertTo-Json -InputObject $filtered.ToArray() -Depth 10
                            [System.IO.File]::WriteAllText($jsonPath, $jsonText, $utf8NoBom)
                            $foundAny = $true
                        }
                    }
                } catch {}
            }

            if ($foundAny) {
                $cleanedEnvs += $envName
                Write-Host "  [已卸載] [$envName]" -ForegroundColor Green
            }
        }

        if ($cleanedEnvs.Count -gt 0) {
            $uninstalledCount++
            $uninstalledSummary += [PSCustomObject]@{
                Name         = $displayName
                Version      = $extVersion
                Environments = ($cleanedEnvs -join ", ")
            }
        } else {
            Write-Host "  [略過] 未在目標環境中偵測到安裝紀錄" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  [錯誤] 清理 $($folder.Name) 時發生例外: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  🎉 全套擴充套件解除安裝完成！共清理 $uninstalledCount 個外掛項目" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
if ($uninstalledSummary.Count -gt 0) {
    $uninstalledSummary | Format-Table -AutoSize
}
Write-Host "提示：Antigravity IDE / Cursor 可按 [Ctrl + Shift + P] -> [Developer: Reload Window] 刷新擴充狀態；VS Code 請完整關閉後重新啟動。" -ForegroundColor Gray
Write-Host ""
