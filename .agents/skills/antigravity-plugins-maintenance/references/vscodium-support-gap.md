# 未結案：VSCodium 支援（README 與實作不一致）

> 稽核日期：2026-10-26（`graphify` 0.9.80 建圖 commit `ea192ae6` 之後，純 grep ＋ 人工核對）

## 事實

| 項目 | 實測結果 |
| :--- | :--- |
| 帶 `vscodium` 字樣的安裝腳本 | **7 支**：6 個外掛的 `install-extension.ps1` ＋ 根 `install-all.ps1` |
| 每支的命中次數 | **各 1 次**，且全部落在 `get-runningideforroot()` 的**程序偵測**（判斷「跑的是 VSCodium 還是 VS Code」） |
| 部署目標（`code`／`codium` CLI 路徑、擴充套件安裝目錄） | **0 個**——沒有任何腳本把 `.vsix` 裝進 VSCodium |
| 卸載腳本 | 6 支 `uninstall-extension.ps1` ＋ 根 `uninstall-all.ps1`，同樣**無** VSCodium 分支 |
| 結論 | `README` 敘述的 VSCodium 支援**大於**實作；是文件與程式碼不一致，不是設定問題 |

## 查法（可重跑）

```powershell
Get-ChildItem -Recurse -Filter 'install*.ps1' |
  Select-String -Pattern 'vscodium' -CaseSensitive:$false |
  Group-Object Path | Select-Object Count, Name
```

判準：命中若只出現在 `get-runningideforroot()` 區塊，就是「只偵測、不部署」。

## 待決（二選一，未定案）

| 選項 | 範圍 | 代價 |
| :--- | :--- | :--- |
| **① 只修文件** | `antigravity-toolbox/README.md` 改寫成「僅 VS Code 相容 IDE 支援，VSCodium 需自行側載 `.vsix`」 | **1 檔 / 3 處**；不動程式 |
| **② 補實作** | 6 支 `install-extension.ps1` ＋ 6 支 `uninstall-extension.ps1` ＋ 根 `install-all.ps1`／`uninstall-all.ps1` 全加 VSCodium 候選 | **14 檔 × 約 5 個修改點**；六份是獨立複本，**必須同步**；改完依 §5 跑 `graphify update .` |

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

## 選項 ②：實作要改的 14 檔

6 × `<plugin>/install-extension.ps1`、6 × `<plugin>/uninstall-extension.ps1`、根 `install-all.ps1`、`uninstall-all.ps1`。

每支 install 腳本 **5 個修改點**（行號以 `antigravity-toolbox` 為準，各外掛一致）：

| # | 位置 | 現況 | 要改成 |
| ---: | :--- | :--- | :--- |
| 1 | L8 `ValidateSet` | `"Antigravity","VSCode","Cursor","All","Prompt"` | 加 `"VSCodium"` |
| 2 | L103–118 互動選單 | `[1]` Antigravity／`[2]` VSCode／`[3]` Cursor／`[4]` All | 加 `[5]` VSCodium（`All` 也要涵蓋） |
| 3 | L160 之後（`$cursorCandidates` 後） | 只有 Antigravity／VS Code／Cursor 三組候選 | 新增 `$vscodiumCandidates`（片段見下） |
| 4 | `$candidatePool = switch ($Target)` | 四個分支；`"All"` 只串三組 | 加 `"VSCodium" { $vscodiumCandidates }`，`"All"` 串上第四組 |
| 5 | 排除表（根 L211–217 `$environmentExclusions`；外掛檔內另有同名表） | key 只有 Cursor／VS Code／Antigravity | 加 `"VSCodium"` key（`quota-status` 應比照 VS Code **排除**：沒有對應 API） |

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

`uninstall-extension.ps1` 是 **4 點**（結構不同，別照抄 install 的片段）：

| # | 位置 | 現況 | 要改成 |
| ---: | :--- | :--- | :--- |
| 1 | L8 `ValidateSet` | 同 install | 加 `"VSCodium"` |
| 2 | L102 互動選單（文案是「欲卸載的目標」） | 1／2／3／4 | 加 `[5]` VSCodium |
| 3 | L122–132 候選（**hashtable** `@{ Name; Path }`，沒有 `CheckPaths`／`CheckCommands`） | Antigravity／VS Code／Insiders／Cursor | 加 `@{ Name = "VSCodium"; Path = (Join-Path $env:USERPROFILE ".vscode-oss\extensions") }` |
| 4 | 候選池 switch | 四個分支 | 加 `"VSCodium"` 分支，`"All"` 串上 |

> uninstall 沒有 `$environmentExclusions`（不需排除表，因為只是移除自己的產物）。

---

## 為什麼「一行偵測」騙人

`Get-RunningIdeForRoot()` 的 `$processMap`（**每支腳本 L45–52**）第 48 行有 `.vscodium = "VSCodium"`，但它只做一件事：**警告「IDE 正在執行，關掉再裝」**。

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

