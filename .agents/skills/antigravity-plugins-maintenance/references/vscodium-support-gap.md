# 未結案：VSCodium 支援（README 與實作不一致）

> 稽核日期：2026-10-26（`graphify` 0.9.80 建圖 commit `ea192ae6` 之後，純 grep ＋ 人工核對）

## 事實

| 項目 | 實測結果 |
| :--- | :--- |
| 帶 `vscodium` 字樣的安裝腳本 | **1 支**：根 `install-all.ps1`（2026-10-26 薄殼化前為 7 支，現由 12 支薄殼轉呼叫根腳本） |
| 每支的命中次數 | **1 次**，且落在 `get-runningideforroot()` 的**程序偵測**（判斷「跑的是 VSCodium 還是 VS Code」） |
| 部署目標（`code`／`codium` CLI 路徑、擴充套件安裝目錄） | **0 個**——沒有任何腳本把 `.vsix` 裝進 VSCodium |
| 卸載腳本 | **1 支**：根 `uninstall-all.ps1`（薄殼化前為 6 支），同樣**無** VSCodium 分支 |
| 結論 | `README` 敘述的 VSCodium 支援**大於**實作；是文件與程式碼不一致，不是設定問題 |

## 查法（可重跑）

```powershell
Get-ChildItem -Recurse -Filter 'install*.ps1' |
  Select-String -Pattern 'vscodium' -CaseSensitive:$false |
  Group-Object Path | Select-Object Count, Name
```

判準：命中若只出現在 `get-runningideforroot()` 區塊，就是「只偵測、不部署」。

## 決策（2026-10-26：採 ① 只修文件）

| 選項 | 狀態 |
| :--- | :--- |
| **① 只修文件** | ✅ **已執行（2026-10-26）**：`antigravity-toolbox/README.md` L3 移除 VSCodium、L61 支援清單移除、原 L68 表格列刪除，改為「⚠️ VSCodium 尚未支援自動掛載」註記（含手動掛載方向＋未驗證警告）。<br>成本：**1 檔 / 3 處**，不動程式 → 文件與實作從此一致 |
| **② 補實作** | ⬜ 未做；清單保留在下方，日後真要支援時照著改 |

選 ② 前的必做：`graphify affected "get-runningideforroot" --depth 2` 先看影響半徑（實測 17 個節點）。

---

## 選項 ①：文件要改的 3 處

| 檔案 | 行 | 內容 |
| :--- | ---: | :--- |
| `antigravity-toolbox/README.md` | 3 | 開頭描述「…Cursor、VS Code、VS Code Insiders、**VSCodium**、Google Antigravity」 |
| `antigravity-toolbox/README.md` | 61 | 「腳本會自動辨識本機已安裝的相容 IDE（…**VSCodium**、Antigravity IDE）並按需掛載」 |
| `antigravity-toolbox/README.md` | 68 | 表格列 `VSCodium | ~/.vscode-oss/extensions | %APPDATA%\VSCodium\User` |

> 根 `README.md` **沒有**提到 VSCodium（2026-10-26 全 repo `*.md` grep 實測，只有 toolbox 這份）。

---

## 選項 ②：實作要改的 **2 檔**（2026-10-26 薄殼化後）

根 `install-all.ps1`、`uninstall-all.ps1`。12 支 `<plugin>/install-extension.ps1`、`uninstall-extension.ps1` 已改為薄殼（只把自己的資料夾名稱轉成 `-Plugin`），改根腳本後自動跟著生效——薄殼化前這裡列的是 14 檔。

> 下方行號已位移，一律以**錨點**定位（2026-10-26 實測：`install-all.ps1` `ValidateSet`＝L12、`$antigravityCandidates`＝L141、`$cursorCandidates`＝L188、`$candidatePool`＝L201、`$environmentExclusions`＝L249；`uninstall-all.ps1` `ValidateSet`＝L8、`$antigravityRoots`＝L136、`$cursorRoots`＝L146、`$candidateRoots`＝L150）。

每支根腳本的 install 側有 **5 個修改點**：

| # | 位置（錨點） | 現況 | 要改成 |
| ---: | :--- | :--- | :--- |
| 1 | `param()` 的 `ValidateSet` | `"Antigravity","VSCode","Cursor","All","Prompt"` | 加 `"VSCodium"` |
| 2 | `if ($Target -eq "Prompt")` 的互動選單 | `[1]` Antigravity／`[2]` VSCode／`[3]` Cursor／`[4]` All | 加 `[5]` VSCodium（`All` 也要涵蓋） |
| 3 | `$cursorCandidates` 之後 | 只有 Antigravity／VS Code／Cursor 三組候選 | 新增 `$vscodiumCandidates`（片段見下） |
| 4 | `$candidatePool = switch ($Target)` | 四個分支；`"All"` 只串三組 | 加 `"VSCodium" { $vscodiumCandidates }`，`"All"` 串上第四組 |
| 5 | `$environmentExclusions` | key 只有 Cursor／VS Code／Antigravity（薄殼化後**只剩根腳本這一份表**） | 加 `"VSCodium"` key（`quota-status` 應比照 VS Code **排除**：沒有對應 API） |

```powershell
$vscodiumCandidates = @(
    [PSCustomObject]@{
        Name = "VSCodium"
        CheckPaths = @(
            (Join-Path $env:USERPROFILE ".vscode-oss"),
            (Join-Path $env:APPDATA "VSCodium"),
            (Join-Path $env:LOCALAPPDATA "Programs\VSCodium"),
            "C:\Program Files\VSCodium"
        )
        CheckCommands = @("codium")
        ExtensionsRoot = (Join-Path $env:USERPROFILE ".vscode-oss\extensions")
    }
)
```

根 `uninstall-all.ps1` 是 **4 點**（結構不同，別照抄 install 的片段）：

| # | 位置（錨點） | 現況 | 要改成 |
| ---: | :--- | :--- | :--- |
| 1 | `param()` 的 `ValidateSet` | 同 install | 加 `"VSCodium"` |
| 2 | `if ($Target -eq "Prompt")` 選單（文案是「欲卸載的目標」） | 1／2／3／4 | 加 `[5]` VSCodium |
| 3 | `$cursorRoots`（**hashtable** `@{ Name; Path }`，沒有 `CheckPaths`／`CheckCommands`） | Antigravity×2／VS Code×2／Cursor | 加 `@{ Name = "VSCodium"; Path = (Join-Path $env:USERPROFILE ".vscode-oss\extensions") }` |
| 4 | `$candidateRoots = switch ($Target)` | 四個分支 | 加 `"VSCodium"` 分支，`"All"` 串上 |

> uninstall 沒有 `$environmentExclusions`（不需排除表，因為只是移除自己的產物）。

---

## 為什麼「一行偵測」騙人

`Get-RunningIdeForRoot()` 的 `$processMap`（根 `install-all.ps1`／`uninstall-all.ps1` 各一份，薄殼不含）有一行 `.vscodium = "VSCodium"`，但它只做一件事：**警告「IDE 正在執行，關掉再裝」**。

它不在任何 `ExtensionsRoot` 候選裡 → 腳本永遠不會把套件掛進 `~/.vscode-oss/extensions`。
**「偵測得到」≠「裝得進去」**，這就是 README 與實作的落差來源。

---

## 驗證方式（本機無 VSCodium 可測）

2026-10-26 實測：`~/.vscode-oss` = **不存在**、`codium` 指令 = **不存在**、`%APPDATA%\VSCodium` = **不存在**（只有 `~/.vscode` 存在）。

| 方式 | 做法 | 適用 |
| :--- | :--- | :--- |
| **假目錄 dry-run** | `New-Item -ItemType Directory "$env:USERPROFILE\.vscode-oss\extensions"` → 跑 `.\install-all.ps1 -Target VSCodium` → 檢查 junction 與 `extensions.json` → **測完刪掉假目錄** | 不想裝 VSCodium |
| **實機** | `winget install VSCodium.VSCodium` 後再跑，重載視窗看面板是否出現 | 要一次到位 |

> ⚠️ `~/.vscode-oss/extensions` 與 `extensions.json` 屬 **VS Code OSS 慣例（推測）**，本機無 VSCodium 可證；要用上表任一方式驗過，才能把「已支援」寫回 README。

