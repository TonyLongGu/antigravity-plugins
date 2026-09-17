<#
.SYNOPSIS
    IDE 擴充套件一鍵安裝腳本
    支援環境嚴格隔離、目標指定 (-Target)、Junction 免編譯掛載與 extensions.json 註冊
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
$sourceDir = $PSScriptRoot

# 動態讀取 package.json 資訊
$pkgJsonPath = Join-Path $sourceDir "package.json"
$extPublisher = "antigravity-toolkit"
$extName = "antigravity-mcp-manager"
$extVersion = "1.4.0"
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

# 互動模式提示
if ($Target -eq "Prompt") {
    $isInteractive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if ($isInteractive) {
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  安裝擴充套件: $displayName" -ForegroundColor Yellow
        Write-Host "  識別碼: $fullExtId (v$extVersion)" -ForegroundColor Gray
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  請選擇安裝目標 IDE 環境 (嚴格隔離，互不干涉)：" -ForegroundColor Yellow
        Write-Host "  [1] Google Antigravity IDE (預設推薦)" -ForegroundColor Green
        Write-Host "  [2] Visual Studio Code" -ForegroundColor White
        Write-Host "  [3] Cursor" -ForegroundColor White
        Write-Host "  [4] 全部已安裝的 IDE (All)" -ForegroundColor Magenta
        Write-Host "========================================" -ForegroundColor Cyan
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
if ($Target -eq "VSCode" -or $Target -eq "Cursor") {
    Write-Host ""
    Write-Host "[提示] 此套件 ($displayName) 專為 Google Antigravity IDE 原生 MCP 伺服器管理打造。" -ForegroundColor Yellow
    Write-Host "在 VS Code / Cursor 環境中不支援，已安全略過安裝。" -ForegroundColor Gray
    Exit 0
}

# 候選 IDE 環境定義

$antigravityTargets = @(
    [PSCustomObject]@{
        Name = "Antigravity IDE"
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity-ide\extensions")
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity-ide"),
            (Join-Path $env:APPDATA "Antigravity IDE")
        )
    },
    [PSCustomObject]@{
        Name = "Antigravity (相容路徑)"
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".antigravity\extensions")
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".antigravity")
        )
    }
)

$vscodeTargets = @(
    [PSCustomObject]@{
        Name = "VS Code"
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode\extensions")
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode"),
            (Join-Path $env:APPDATA "Code")
        )
    },
    [PSCustomObject]@{
        Name = "VS Code Insiders"
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode-insiders\extensions")
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode-insiders")
        )
    }
)

$cursorTargets = @(
    [PSCustomObject]@{
        Name = "Cursor"
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".cursor\extensions")
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".cursor"),
            (Join-Path $env:APPDATA "Cursor")
        )
    }
)

$candidatePool = switch ($Target) {
    "Antigravity" { $antigravityTargets }
    "VSCode"      { $vscodeTargets }
    "Cursor"      { $cursorTargets }
    "All"         { $antigravityTargets + $vscodeTargets + $cursorTargets }
    Default       { $antigravityTargets }
}

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
    if ($matched) {
        $targetEnvironments += $c
    }
}

if ($targetEnvironments.Count -eq 0) {
    Write-Host ""
    Write-Host "[警告] 未於本機偵測到任何符合條件的指定 IDE ($Target)！" -ForegroundColor Yellow
    Write-Host "腳本已中止，未建立任何多餘資料夾。" -ForegroundColor Gray
    Exit 0
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安裝擴充套件: $displayName" -ForegroundColor Yellow
Write-Host "  套件識別: $fullExtId (v$extVersion)" -ForegroundColor Gray
Write-Host "  目標環境: $(($targetEnvironments | ForEach-Object { $_.Name }) -join ', ')" -ForegroundColor Green
$runningIdes = Get-RunningIdeForRoot -ExtensionRoots ($targetEnvironments | ForEach-Object { $_.ExtensionsRoot })
if ($runningIdes.Count -gt 0) {
    Write-Host "[警告] 偵測到目標 IDE 正在執行中：$($runningIdes -join ', ')" -ForegroundColor Yellow
    Write-Host "       建議先完整關閉該 IDE 後再執行本腳本；否則 IDE 關閉時可能覆寫 extensions.json 快取，導致本次變更未生效。" -ForegroundColor Yellow
}
Write-Host "  環境隔離: 生效中 (僅部署所選目標，絕不更動或刪除其他 IDE 之套件)" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

$successCount = 0

foreach ($envTarget in $targetEnvironments) {
    $baseRoot = $envTarget.ExtensionsRoot
    $envName = $envTarget.Name
    Write-Host "`n>> 正在部署至 [$envName]..." -ForegroundColor Cyan

    if (-not (Test-Path -LiteralPath $baseRoot)) {
        New-Item -ItemType Directory -Path $baseRoot -Force | Out-Null
    }

    # 1. 僅在此目標 IDE 目錄下清理該套件舊版連結與別名
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
        Write-Host "  [成功] 已建立連結: $targetPath" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "  [失敗] 無法建立連結 $targetPath : $_" -ForegroundColor Red
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
        Write-Host "  [成功] 已註冊至擴充清單: $jsonPath" -ForegroundColor Green
    } catch {
        Write-Host "  [提示] extensions.json 註冊略過: $($_.Exception.Message)" -ForegroundColor Gray
    }
}

Write-Host ""
if ($successCount -gt 0) {
    Write-Host "擴充套件安裝成功！Antigravity IDE / Cursor 可按 [Ctrl + Shift + P] -> [Developer: Reload Window] 載入；VS Code 請完整關閉後重新啟動。" -ForegroundColor Green
}
