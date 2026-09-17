<#
.SYNOPSIS
    IDE 擴充套件一鍵卸載腳本
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
$sourceDir = $PSScriptRoot

# 動態讀取 package.json 資訊
$pkgJsonPath = Join-Path $sourceDir "package.json"
$extPublisher = "antigravity-toolkit"
$extName = "antigravity-toolbox"
$extVersion = "1.3.7"
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

# 互動模式提示
if ($Target -eq "Prompt") {
    $isInteractive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if ($isInteractive) {
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  解除安裝擴充套件: $displayName" -ForegroundColor Yellow
        Write-Host "  識別碼: $fullExtId" -ForegroundColor Gray
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  請選擇欲卸載的目標 IDE 環境 (嚴格隔離，互不干涉)：" -ForegroundColor Yellow
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

# 候選 IDE 環境擴充套件路徑
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

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  解除安裝 IDE 原生擴充套件 ($Target 目標模式)" -ForegroundColor Cyan
Write-Host "  套件名稱: $displayName ($fullExtId)" -ForegroundColor Yellow
Write-Host "  環境隔離: 生效中 (僅清理所選目標，絕不更動其他 IDE 之擴充)" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

$uninstalledAny = $false

$runningIdes = Get-RunningIdeForRoot -ExtensionRoots ($candidateRoots | ForEach-Object { $_.Path })
if ($runningIdes.Count -gt 0) {
    Write-Host "[警告] 偵測到目標 IDE 正在執行中：$($runningIdes -join ', ')" -ForegroundColor Yellow
    Write-Host "       建議先完整關閉該 IDE 後再執行本腳本；否則 IDE 關閉時可能覆寫 extensions.json 快取，導致本次變更未生效。" -ForegroundColor Yellow
}
foreach ($targetItem in $candidateRoots) {
    $baseRoot = $targetItem.Path
    $envName = $targetItem.Name
    if (-not (Test-Path -LiteralPath $baseRoot)) { continue }

    $foundInThisEnv = $false

    # 1. 僅刪除目標目錄之 Junction
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
                Write-Host "  [OK] [$envName] 已移除連結: $($diskItem.FullName)" -ForegroundColor Green
                $foundInThisEnv = $true
            } catch {
                cmd.exe /c "rd /s /q `"$($diskItem.FullName)`"" 2>$null
                $foundInThisEnv = $true
            }
        }
    }

    # 2. 清理目標目錄之 .obsolete
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

    # 3. 從目標目錄之 extensions.json 移除註冊紀錄
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
                    Write-Host "  [OK] [$envName] 已從擴充清單取消註冊: $jsonPath" -ForegroundColor Green
                    $foundInThisEnv = $true
                }
            }
        } catch {
            Write-Host "  [WARN] [$envName] Skip extensions.json cleanup: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }

    if ($foundInThisEnv) {
        $uninstalledAny = $true
    }
}

Write-Host ""
if ($uninstalledAny) {
    Write-Host "擴充套件卸載完成！Antigravity IDE / Cursor 可按 [Ctrl + Shift + P] -> [Developer: Reload Window] 刷新；VS Code 請完整關閉後重新啟動。" -ForegroundColor Green
} else {
    Write-Host "未在目標環境 [$Target] 中發現任何該套件的安裝紀錄。" -ForegroundColor DarkGray
}
