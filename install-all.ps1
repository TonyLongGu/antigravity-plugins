<#
.SYNOPSIS
    IDE 原生擴充套件 - 全套一鍵安裝程式
    支援環境嚴格隔離、目標指定 (-Target)、Junction 免編譯掛載與 extensions.json 自動註冊
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
        Write-Host "  IDE 原生擴充套件 - 全套一鍵安裝程式" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  請選擇安裝目標 IDE 環境 (環境嚴格隔離，互不干涉)：" -ForegroundColor Yellow
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

# 定義各環境候選對象
$antigravityCandidates = @(
    [PSCustomObject]@{
        Name = "Antigravity IDE"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity-ide"),
            (Join-Path $env:APPDATA "Antigravity IDE"),
            (Join-Path $env:USERPROFILE ".gemini\antigravity-ide"),
            (Join-Path $env:LOCALAPPDATA "Programs\Antigravity")
        )
        CheckCommands = @("agy", "antigravity")
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity-ide\extensions")
    },
    [PSCustomObject]@{
        Name = "Antigravity (相容路徑)"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity")
        )
        CheckCommands = @()
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity\extensions")
    }
)

$vscodeCandidates = @(
    [PSCustomObject]@{
        Name = "VS Code"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode"),
            (Join-Path $env:APPDATA "Code"),
            (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code"),
            "C:\Program Files\Microsoft VS Code"
        )
        CheckCommands = @("code")
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode\extensions")
    },
    [PSCustomObject]@{
        Name = "VS Code Insiders"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode-insiders"),
            (Join-Path $env:APPDATA "Code - Insiders"),
            (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code Insiders"),
            "C:\Program Files\Microsoft VS Code Insiders"
        )
        CheckCommands = @("code-insiders")
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode-insiders\extensions")
    }
)

$cursorCandidates = @(
    [PSCustomObject]@{
        Name = "Cursor"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".cursor"),
            (Join-Path $env:APPDATA "Cursor"),
            (Join-Path $env:LOCALAPPDATA "Programs\cursor")
        )
        CheckCommands = @("cursor")
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".cursor\extensions")
    }
)

$candidatePool = switch ($Target) {
    "Antigravity" { $antigravityCandidates }
    "VSCode"      { $vscodeCandidates }
    "Cursor"      { $cursorCandidates }
    "All"         { $antigravityCandidates + $vscodeCandidates + $cursorCandidates }
    Default       { $antigravityCandidates }
}

# 僅篩選實際存在的環境
$targetEnvironments = @()
foreach ($c in $candidatePool) {
    $matched = $false
    if (Test-Path -LiteralPath $c.ExtensionsRoot) {
        $matched = $true
    }
    if (-not $matched) {
        foreach ($cp in $c.CheckPaths) {
            if (Test-Path -LiteralPath $cp) {
                $matched = $true
                break
            }
        }
    }
    if (-not $matched -and $c.CheckCommands.Count -gt 0) {
        foreach ($cmd in $c.CheckCommands) {
            if (Get-Command $cmd -ErrorAction SilentlyContinue) {
                $matched = $true
                break
            }
        }
    }
    if ($matched) {
        $targetEnvironments += $c
    }
}

# 排除清單 (針對特定 IDE 不適用的專用工具)
# MCP 管理儀表板已支援三端：Antigravity 原生開關；Cursor / VS Code 為檢視模式
# 已併入 antigravity-quota-status，不再獨立安裝
$retiredExtensions = @(
    "cursor-quota-status", "antigravity-toolkit.cursor-quota-status"
)

# 額度監控可裝 Antigravity + Cursor；VS Code 沒有對應 API
$quotaExtensions = @(
    "antigravity-quota-status", "ai-quota-status", "antigravity-toolkit.ai-quota-status"
)

$environmentExclusions = @{
    "Cursor"                   = $retiredExtensions
    "VS Code"                  = $retiredExtensions + $quotaExtensions
    "VS Code Insiders"         = $retiredExtensions + $quotaExtensions
    "Antigravity IDE"          = $retiredExtensions
    "Antigravity (相容路徑)"   = $retiredExtensions
}


Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  IDE 原生擴充套件 - 全套一鍵安裝程式 ($Target 目標模式)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "安裝來源: $pluginsDir" -ForegroundColor Gray

if ($targetEnvironments.Count -eq 0) {
    Write-Host ""
    Write-Host "[警告] 未於本機偵測到任何已安裝的指定 IDE ($Target)！" -ForegroundColor Yellow
    Write-Host "本腳本已自動中止，未在您的系統中建立任何多餘資料夾。" -ForegroundColor Yellow
    Exit 0
}

Write-Host "目標環境: $(($targetEnvironments | ForEach-Object { $_.Name }) -join ', ') " -ForegroundColor Green
$runningIdes = Get-RunningIdeForRoot -ExtensionRoots ($targetEnvironments | ForEach-Object { $_.ExtensionsRoot })
if ($runningIdes.Count -gt 0) {
    Write-Host "[警告] 偵測到目標 IDE 正在執行中：$($runningIdes -join ', ')" -ForegroundColor Yellow
    Write-Host "       建議先完整關閉該 IDE 後再執行本腳本；否則 IDE 關閉時可能覆寫 extensions.json 快取，導致本次變更未生效。" -ForegroundColor Yellow
}
Write-Host "環境隔離: 生效中 (僅部署所選目標，絕不更動或刪除其他 IDE 之套件)" -ForegroundColor DarkGray

$pluginFolders = Get-ChildItem -LiteralPath $pluginsDir -Directory
if ($pluginFolders.Count -eq 0) {
    Write-Host "[錯誤] 未發現任何擴充套件資料夾！" -ForegroundColor Red
    Exit 1
}

$totalPlugins = 0
$installedSummary = @()

foreach ($folder in $pluginFolders) {
    $pkgJsonPath = Join-Path $folder.FullName "package.json"
    if (-not (Test-Path -LiteralPath $pkgJsonPath)) {
        continue
    }

    $totalPlugins++
    try {
        $pkg = Get-Content -LiteralPath $pkgJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $extName = $pkg.name
        $extPublisher = if ($pkg.publisher) { $pkg.publisher } else { "antigravity-toolkit" }
        $extVersion = if ($pkg.version) { $pkg.version } else { "1.0.0" }
        $displayName = if ($pkg.displayName) { $pkg.displayName } else { $extName }
        $fullExtId = "$extPublisher.$extName"
        $standardFolderName = "$fullExtId-$extVersion"
        $sourceDir = $folder.FullName

        Write-Host "`n------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "▶ 正在處理: $displayName" -ForegroundColor Yellow
        Write-Host "  識別碼: $fullExtId (v$extVersion)" -ForegroundColor Gray

        $deployedEnvs = @()

        foreach ($envTarget in $targetEnvironments) {
            $baseRoot = $envTarget.ExtensionsRoot
            $envName = $envTarget.Name

            # 檢查是否為該環境的排除清單
            $exclusions = if ($environmentExclusions.ContainsKey($envName)) { $environmentExclusions[$envName] } else { @() }
            $isExcluded = ($exclusions -contains $folder.Name) -or ($exclusions -contains $extName) -or ($exclusions -contains $fullExtId)

            if ($isExcluded) {
                Write-Host "  [略過] ${envName}: 此環境不適用，已安全略過" -ForegroundColor DarkGray
                continue
            }

            if (-not (Test-Path -LiteralPath $baseRoot)) {
                New-Item -ItemType Directory -Path $baseRoot -Force | Out-Null
            }

            # 1. 僅清理該目標 IDE 目錄下該套件的所有舊版連結與別名
            if (Test-Path -LiteralPath $baseRoot) {
                $existingDiskItems = @(Get-ChildItem -LiteralPath $baseRoot)
                foreach ($diskItem in $existingDiskItems) {
                    $diname = $diskItem.Name
                    $shouldDelete = Test-IsOwnExtensionArtifact -Name $diname -FullExtId $fullExtId -ExtName $extName

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
                Write-Host "  [OK] 已連結至 [$envName]" -ForegroundColor Green
                $deployedEnvs += $envName
            } catch {
                Write-Host "  [失敗] 無法建立連結 [$envName] $targetPath : $_" -ForegroundColor Red
                continue
            }

            # 3. 清除該環境 .obsolete 中的廢棄標記
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

            # 4. 註冊至該環境 extensions.json
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
            } catch {
                Write-Host "  [提示] [$envName] extensions.json 註冊略過: $($_.Exception.Message)" -ForegroundColor Gray
            }
        }

        if ($deployedEnvs.Count -gt 0) {
            $installedSummary += [PSCustomObject]@{
                Name = $displayName
                Version = $extVersion
                Environments = ($deployedEnvs -join ", ")
            }
        }
    } catch {
        Write-Host "  [錯誤] 處理 $($folder.Name) 時發生例外: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  🎉 全套擴充套件安裝作業完成！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
if ($installedSummary.Count -gt 0) {
    $installedSummary | Format-Table -AutoSize
}
Write-Host "提示：Antigravity IDE / Cursor 可按 [Ctrl + Shift + P] -> [Developer: Reload Window] 載入；VS Code 請完整關閉後重新啟動，才會重新掃描擴充目錄。" -ForegroundColor Gray
Write-Host ""
