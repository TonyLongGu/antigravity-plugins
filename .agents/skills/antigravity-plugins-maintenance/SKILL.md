---
name: antigravity-plugins-maintenance
description: 維護 antigravity-plugins（6 個 VS Code 擴充套件同一個 repo）的專案知識：圖譜讀取紀律、改完自動更新授權、跨外掛 command id 耦合、六外掛速查、安裝腳本與 Skills 連結同步。當在此 repo 工作、要改安裝腳本或 command id、要查外掛結構與節點數、要重建圖譜，或提到 scriptRunner.*／antigravity.toolbox.* 時觸發。
---

# antigravity-plugins：專案維護（Antigravity Plugins Maintenance）

> 一句話：**這個 repo 的「事實」都集中在這裡；但事實會過期——§3 的數字一律先驗證再用。**
> 分工：圖譜的**通用流程**（何時建、怎麼驗、怎麼回報）→ skill `graphify-knowledge-graph`（在別的技能包，本 repo 未必載入；沒載入就用本檔 §4／§9 的自足版本）。本技能只管**這個 repo 的常數、耦合與授權**。
> 本檔＝**專案知識主技能**：repo 根 `AGENTS.md` 只有技能索引；`docs/project-notes.md` 已於 2026-10-28 併回本檔後**刪除**（回收筒可還原），⛔ 不要再建平行副本。

---

## 1. 快速觸發

| 類型 | 內容 |
| :--- | :--- |
| **正例** | 「antigravity-plugins 的安裝腳本要改哪裡？」／「quota-status 現在幾個節點？」 |
| **正例** | 「改 `scriptRunner.runBat` 這個 id 會壞什麼？」／「這個 repo 的圖譜過期了嗎？」 |
| **負例** | 「幫我建一份知識圖譜」→ `graphify-knowledge-graph`（本技能不含通用建圖流程） |
| **負例** | 「這台機器做個環境健檢」／「幫我刪掉這些暫存檔」→ `health-check`／`safe-delete` |
| **怎麼被叫用** | repo 根 `AGENTS.md` 的**技能索引**會指向本技能；也可直接打 `/antigravity-plugins-maintenance`。⚠️ 技能清單沒看到本技能 ⇒ 直接讀 `.agents/skills/antigravity-plugins-maintenance/SKILL.md`（junction 未同步時會這樣） |

> **何時不必用本技能**：只問「graphify 怎麼安裝／怎麼建圖」→ `graphify-knowledge-graph`；只問「外掛有沒有裝起來、環境對不對」→ `health-check`；處理的是**別的 repo** → 那個 repo 自己的 `AGENTS.md`／技能。

---

## 2. 這個 repo 是什麼

單一 git repo，內含 **6 個獨立 VS Code 擴充套件** ＋ 根目錄安裝腳本（`install-all.ps1`／`uninstall-all.ps1` 及 `.bat` 包裝）。

- **沒有程式碼共用**：2026-10-27 實測 2,974 條邊只有 **1 條**「跨外掛」（且是 `node:sqlite` builtin 的誤判）。真正的耦合是 **VS Code command id 字串**，見 §7。
- **安裝邏輯只在根目錄 2 支腳本**：各外掛的 `install-extension.ps1`／`uninstall-extension.ps1`（共 12 支）自 2026-10-26 起是**薄殼**（各約 47 行、只剩語句沒有函式），只把自己的資料夾名稱當 `-Plugin` 轉呼叫根腳本。⇒ 改一次 6 個外掛同時生效。
- **安裝政策＝一鍵全裝**（2026-10-26 起）：根 `install-all.ps1` 的 `-Target` 預設 `All`、`-Plugin` 省略＝全部外掛（可給資料夾名稱或 `package.json` 的 `name`，例：`-Plugin antigravity-quota-status` 或 `-Plugin ai-quota-status`）。`-Target Prompt` 在根腳本是互動選單，在 install 薄殼回溯相容為 `All`；uninstall 薄殼仍是選單。目標 IDE 由腳本自動偵測，使用者改用面板頂部「類別切換鈕」決定看哪一套 IDE 資料；不相容組合由 `$environmentExclusions` 自動略過。
- **測試＝零相依、直接 `node <檔案>`**（無框架）。2026-11-02 實測 **15 支**：
  `antigravity-toolbox/tests/`（`environment-flavor`／`kilo-brain-stats`／`mcp-label`／`skill-junction-sync`／`skill-sync-service`／`workspace-dedupe`／`workspace-remove`）、
  `antigravity-ai-context-inspector/tests/`（`cline-snapshot`／`cline-conditional-rules`／`kilo-snapshot`／`mcp-vscode-sources`／`skill-junction-scan`／`snapshot-source-default`）、
  `antigravity-mcp-manager/tests/`（`agent-host-enablement`／`kilo-mcp-service`）。
- **webview 前端**在 `media/`，**不進圖**（§3）。六個外掛都是 `main: ./extension.js`、CommonJS。

---

## 3. 圖譜常數（2026-11-04 複驗，graphify 0.9.80）

| 項目 | 值 |
| :--- | :--- |
| 圖譜位置 | `graphify-out/`（根 `.gitignore` 已排除，**勿 commit**） |
| 規模 | **1910** nodes / **3432** edges / **122** communities（76 顯示、46 thin 省略） |
| 建圖標記 | `Built from commit` `cc6db55f`（＝目前 HEAD；toolbox 1.8.2 的改動仍在工作樹，`update` 已反映內容）。再跑 `update` 若回 `No code-graph topology changes detected` ⇒ 內容與工作樹一致 |
| 語料 | 113 files · ~146,196 words；**81 個 code 檔**被抽取（AST）；30 檔未分類（`.bat` 14、無副檔名 10、`.css` 6） |
| 抽取品質 | 96% EXTRACTED／4% INFERRED（146 邊，平均信心 0.85）；**0 input／0 output token＝0 元** |
| 產物大小 | `GRAPH_REPORT.md` **20.1 KB**（20,550 B，可整讀）、`graph.json` **2.3 MB**（2,337,781 B，禁整讀）、`graph.html` 約 1.89 MB |
| 節點分佈 | script-runner 455／inspector 446／toolbox **432**／mcp-manager 298／quota-status 174／quick-access 79／根目錄 26（含 `node:sqlite` 1 與 2 支根腳本） |
| 不進圖 | `*.css`、`*.html`、`locales/*.json`、`*.md`（`.graphifyignore` 已排除 `*.md`） |

> ⚠️ 上表是**快照**。用前先驗（三行）：
>
> ```powershell
> Test-Path graphify-out\graph.json                                    # True
> Get-Content graphify-out\GRAPH_REPORT.md -TotalCount 15 -Encoding UTF8  # Summary ＋ Built from commit
> git rev-parse --short=8 HEAD                                          # 8 碼比對，別用預設 7 碼
> ```
>
> 📌 本檔是 `*.md`、不進圖 ⇒ 只改本檔**不需要**跑 `update`。

---

## 4. 讀取紀律（省 token）

1. **先讀** `graphify-out/GRAPH_REPORT.md` 的 `## Summary` 段（整份 17.2 KB 全讀也划算）。
2. 要細節才用 CLI（本地、免 API key、零成本）：`god-nodes --top 10`／`explain "<節點>"`／`affected "<節點>" --depth 2`／`path "A" "B"`／`query "<問題>" --context call --budget 1500`。
3. **永不整檔讀** `graph.json`（2.0 MB）。
4. 社群名是 `Community N`（建圖用 `--no-label`，未付 LLM 費用）→ 導航靠 `god-nodes`，不要期待語意化社群名。
5. 要改動時才開原始碼，並用圖譜給的 `檔名:行號` 直接跳。
6. 圖譜與程式碼不一致 ⇒ **以程式碼為準**，收尾依 §5 更新。

> 📌 **同名節點要加路徑**：`explain "McpConfigService"` 會回 `Ambiguous`（3 個節點：service 本體／`extension.js` 引用／測試）。改用 `graphify explain "antigravity-mcp-manager/services/mcpConfigService.js::McpConfigService"`（實測可用，Source 指到 `L35`）。

> 📌 **`$LASTEXITCODE` 不可靠**：實測 `explain`／`query`／`god-nodes` 成功也回 `-1`（只有 `extract`／`cluster-only`／`update` 回 `0`）。成敗請看輸出；`query` 出現 `TRUNCATED` 是預算不足，加大 `--budget` 或縮小問題，**不是壞掉**。

---

## 5. 改完自動更新（**本節即授權**）

- 改了**被抽取的檔案**（`.js`／`.ps1`／`package.json`）⇒ 收尾**直接執行** `graphify update .`，**不需要再詢問使用者**；完成後回報節點／邊／社群數變化與 `Built from commit` 是否＝HEAD。
- **只改** `.md`／`.css`／`locales/*.json` ⇒ **不要**跑 `update`（屬無害過期；`.graphifyignore` 已排除 `*.md`）。
- 邊界：

| 情況 | 做法 |
| :--- | :--- |
| 一般更新 | `graphify update .` |
| 無拓撲變更 | 會回 `No code-graph topology changes detected; outputs left untouched.`，`$LASTEXITCODE`＝`0` ⇒ **正常**，不要重跑 |
| 節點數變少被「縮圖保護」擋下 | 才加 `--force` |
| 想順手重分群 | ⛔ **不要加 `--no-cluster`**（會寫出沒有 community 的 `graph.json`，報告仍是舊分群） |
| `graphify-out/` 不存在 | ⛔ **不可**直接 `update` ⇒ 見 §9 |
| 產物 | `graphify-out/` **不 commit**（2 MB 級產物、重建 3 秒 0 元） |

> 📌 **實測坑（2026-10-28）**：`graphify update . 2>&1 \| Select-Object -Last 25` 會讓 PowerShell 把 stderr 的「18 檔零符號」warning 變成 `NativeCommandError` ⇒ 命令看似 **exit 1 假失敗**。正確判讀：① 用 `graphify update .` 直接跑再看 `$LASTEXITCODE`；② 或看輸出最後一行 `Code graph updated`／`No code-graph topology changes`。18 檔零符號是常態（12 支薄殼＋`media/*/locales.js` 等），⛔ 不要為此改腳本或加旗標。

---

## 6. 圖譜邊界

| 抓得到（附 `檔名:行號`，可靠） | 抓不到（別浪費時間查圖） |
| :--- | :--- |
| 類別／方法呼叫、`require`、繼承、`package.json` contributes | 跨外掛 **command id 字串**（§7 人工維護）、`workbench.view.extension.<container>` |
| PowerShell 函式（實測 `.ps1` 有節點） | `.css`／`.html`／DOM id、`locales/*.json` 的 i18n 鍵 |
| 檔案 → 符號 → 社群歸屬 | runtime 動態呼叫、`env` 等設定資料 |

> ⚠️ **同名 helper 只剩 2 份**（薄殼化後）：`Get-RunningIdeForRoot()`、`Test-IsOwnExtensionArtifact()` 僅存在於根 `install-all.ps1`／`uninstall-all.ps1`；`explain` 可能回多筆同 label ⇒ 用 `source_file` 辨識。改安裝邏輯只需同步這 2 支。（查法：`Select-String -Path *\install*.ps1,*\uninstall*.ps1 -Pattern 'function Get-RunningIdeForRoot'`）

> ℹ️ **18 個 code 檔「掃到但零符號」**屬正常：12 支薄殼只剩語句、＋`media/*/locales.js` 的 i18n 資料表、`quota-refresh-trigger.ps1` 等。`update` 每次都會印 stderr warning（`$LASTEXITCODE`＝0）。

---

## 7. 跨外掛耦合（圖譜盲區；2026-10-27 重新 grep 複驗）

| 呼叫方 | 被呼叫的 command id | 依賴外掛 |
| :--- | :--- | :--- |
| `antigravity-quick-access/extension.js` | `scriptRunner.runBat`、`scriptRunner.runBatAdmin`、`scriptRunner.runPs1`、`scriptRunner.runPs1Admin`、`scriptRunner.runPy`、`scriptRunner.viewFolderImages`、`scriptRunner.viewFolderAudios`、`scriptRunner.viewFolderVideos`（8 個） | `antigravity-script-runner` |
| `antigravity-quick-access/extension.js` | `antigravity.toolbox.addScriptToRunner` | `antigravity-toolbox` |

- 這些全是 `executeCommand('<id>')` **字串呼叫**，AST 產不出邊 ⇒ **改 id 或移除外掛前必須 grep**：

  ```powershell
  Select-String -Path 'antigravity-quick-access\extension.js' `
    -Pattern 'scriptRunner\.[A-Za-z0-9]+|antigravity\.toolbox\.[A-Za-z0-9]+' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
  ```

- `scriptRunner.locale` 是**設定鍵**（`e.affectsConfiguration('scriptRunner.locale')`），**不是 command id** —— grep 時容易誤判，改 id 時不要動它。
- `antigravity.aiContextView.focus`、`antigravity.mcpManagerView.focus`、`antigravity.toolboxView.focus`、`workbench.view.extension.antigravity-toolbox-container` 都是**各外掛自我引用**，不算跨外掛依賴（已逐一查證）。

---

## 8. 六外掛速查

> 版本＝2026-11-02 讀 `package.json` 實測（toolbox 已升 1.8.0、inspector 1.2.8）；節點＝2026-10-31 圖譜實測。兩者都會過期 ⇒ 版本看各外掛 `package.json` 的 `version`，節點用 §3 的查法。

| 外掛 | 版本 | 節點 | 對外 id 家族 | view／container | 進入點／服務 |
| :--- | :--- | ---: | :--- | :--- | :--- |
| `antigravity-script-runner` | 1.7.1 | 455 | `scriptRunner.*`（8 個 id × `.en`／`.cn`＝24） | 無 view（右鍵選單＋媒體檢視） | `extension.js`／6 services（audio／video／image／stream） |
| `antigravity-ai-context-inspector` | 1.3.1 | 446 | `antigravity.aiContext.*`（3 ＋ `.en`） | `antigravity.aiContextView`／`antigravity-ai-context-container` | `extension.js`／7 services（cline·cursor·kilo·vscode chat／contextScanner／mcpDetector） |
| `antigravity-toolbox` | 1.8.1 | 406 | `antigravity.toolbox.*`（7 ＋ 4 `.en`） | `antigravity.toolboxView`／`antigravity-toolbox-container` | `extension.js`／6 services（brain／copilotChat／skillSync／workspace…） |
| `antigravity-mcp-manager` | 1.10.1 | 298 | `antigravity.mcp.*`（6 ＋ `.en`） | `antigravity.mcpManagerView`／`mcp-manager-container` | `extension.js`／9 services |
| `antigravity-quota-status` | 1.1.0（`name`＝`ai-quota-status`） | 174 | `aiQuota.*`（7，無變體） | 無 view（狀態列） | `extension.js`／4 services（quota／cursorAuth…） |
| `antigravity-quick-access` | 1.2.6 | 79 | `antigravity.quickAccess.*`（20 × 3＝60） | `antigravity.quickAccessView` | `extension.js`／無 `services/` 目錄 |

> 六個外掛都是 `main: ./extension.js`、CommonJS；`engines.vscode` 除 quota-status（`^1.68.0`）外皆 `^1.80.0`（2026-10-26）。

### 8.1 toolbox 的資料類別（flavor）切換

- 判定集中在 `antigravity-toolbox/services/systemService.js`：`getFlavorOverride()`（讀 `antigravity.uiFlavor`）→ `resolveFlavor()` → `getGlobalPaths(flavor)`／`collectBrainSessionDirs(flavor)`；`brainService` 以 `resolveFlavor()` 決定走 Brain 或 Copilot 分支。**切換類別後必須呼叫 `invalidateCache()`**（5 秒快取，否則顯示舊類別）。
- 回歸測試：`node antigravity-toolbox/tests/environment-flavor.test.js`；i18n 鍵改動跑 `node antigravity-toolbox/tests/mcp-label.test.js`。
- 切換鈕（1.6.0 起）＝**彩色 chips**，順序固定 `Antigravity` → `Copilot` → `Cursor` → `Cline` → `Kilo`（不隨宿主變動）：`Antigravity`（綠 `#4ec9b0`）／`Copilot`（藍 `#9cdcfe`）／`Cursor`（橘 `#ce9178`）／`Cline`（紫 `#c586c0`）／`Kilo`（黃 `#ffd54f`）。只在啟用態上色、**不顯示對話筆數**（`flavorCounts`／`getFlavorSessionCounts` 已於 1.6.0 移除，勿再加回）。

### 8.2 toolbox 的工作區清單（重複登記＋拖曳手勢，1.7.0）

- **症狀**：面板同時出現兩份同名專案；切換開關只有其中一份變色；`~/.agents/skills` 連結數與稽核「預期」對不上（實測預期 240／實際 129）。
- **根因**：在 VS Code 對**已載入**的專案再執行一次「將資料夾加入工作區」，會把同一路徑**再插一筆**（`folders` 27 筆／唯一 14）；`findIndex` 只命中最前面那筆 ⇒ 切換後重複項分裂到 `disabledFolders`。
- **舊行為的連鎖災難**：`syncFolderOrder()` 以「啟用清單長度＝唯一序列長度」比對，重複存在時永遠 `hasSequenceDiff = true` ⇒ 每次 `analyzeWorkspace()` 都 `saveWorkspaceJson()` **空寫**（`.bak` 與主檔同內容、時間戳只差 1 秒）；而 `fixWorkspaceDuplicates()` 只改 `name`、**不去重**，不會自癒。
- **修正（1.6.2）**：新增 `workspaceService.dedupeWorkspaceItems(json, wsDir)`（同路徑只留第一筆；`folders` 與 `disabledFolders` 都有時**啟用優先**），並在 `analyzeWorkspace()`（自癒＋`deduplicatedCount`＋提示列回報）、`fixWorkspaceDuplicates()`、`setWorkspaceFolderEnabled()`／`batchSetWorkspaceFoldersEnabled()`（切換前先清）呼叫；`syncFolderOrder()` 改以**唯一集合**比對；命令標題改為「自動修正工作區重複專案（同名＋重複登記）」。
- **回歸測試**：`node antigravity-toolbox/tests/workspace-dedupe.test.js`（D1 自癒／D2 不得再空寫／D3 同名＋重複同修／D4 切換只動一筆／D5 純函式邊界）。
- **拖曳手勢（1.7.0）**：
  - 排序：`media/app.js` 的 `startCardPointerInteraction()` 以自訂 pointer 引擎（非 HTML5 DnD）在清單內重排，放手呼叫 `commitFolderReorder()` → `reorderWorkspaceFolders()` 寫 `folderOrder`。
  - 拖出即移除：同一引擎判定游標離開 webview 邊界（`DRAG_OUT_EDGE_PX = 6`；另監聽 `pointerout`／`mouseleave` 的 `relatedTarget === null`，側邊欄 iframe 逸出時收不到座標也能觸發）⇒ 顯示 `#drag-remove-overlay` 紅色遮罩 ⇒ 放手送 `removeWorkspaceFolder` → `workspaceService.removeWorkspaceFolder()`。
  - 後端移除範圍＝`folders`＋`disabledFolders`＋`folderOrder`（再跑 `syncFolderOrder()` 重建），**立即寫檔**（`saveWorkspaceJson(..., true)`）後 `pushStatus(0)`；只改 `.code-workspace`，不刪專案資料夾，`maybeSyncSkills()` 會解掉該專案的 Skills 連結。
  - 只在 `analyzeWorkspace().hasMultiRoot`（有 `.code-workspace`）時啟用；單一資料夾視窗仍可排序但不能移除。Esc／視窗失焦＝取消手勢。
  - ⚠️ webview 邊界的 `pointerup` 不保證送達（iframe 逸出到 VS Code 主文件）：已用 `pointermove.buttons === 0` 補收尾 ⇒ 若「拖出→放開→再移回面板」才看到卡片消失，屬正常降級而非 bug。
  - 回歸測試：`node antigravity-toolbox/tests/workspace-remove.test.js`（R1 啟用中／R2 隱藏中／R3 找不到不寫檔／R4 相對路徑＋無 folderOrder／R5 重複登記／R6 無工作區）。
- **已無「自動」鈕**：未指定時以 `autoFlavor` 為作用中，點「目前宿主」那顆 chip 即回寫 `auto`。
- `cline` 是**外掛而非宿主**（`auto` 永遠不會命中，只能手動點）。路徑見 `systemService.getGlobalPaths('cline')`：`~/.cline`，MCP 在 `data/settings`、對話在 `data/sessions`（舊版退回 `globalStorage/saoudrizwan.claude-dev/tasks`）。⚠️ 清理 Cline **只刪 session 資料夾**，不動 `data/db/*.db`（Cline 介面可能仍列出已刪項目）。
- **`kilo`（1.8.0 起，同樣是外掛）**：Kilo Code 7.x 改成 opencode 架構，**不能照抄 Cline 的路徑**。實測（`kilocode.kilo-code-7.8.18` 的 `dist/extension.js`＋本機實際目錄）：
  - 設定：`~/.config/kilo/kilo.jsonc`（XDG；舊版相容 `~/.kilo`、`~/.kilocode`）→ `globalConfig`。
  - 資料：`~/.local/share/kilo`（`kilo.db`、`storage/`、`auth.json`）→ `appData` 與 `brain`（對話本體在 SQLite）。
  - MCP：`~/.config/kilo/kilo.jsonc` 的 `mcp` 段優先；沒有才退回 `<IDE User>/globalStorage/kilocode.kilo-code/settings/mcp_settings.json`。⚠️ `handleOpenTarget('mcpConfig')` 對 `.jsonc` **缺檔只開資料夾、不寫預設內容**（否則會蓋掉使用者設定）。
  - 對話：7.x 在 `kilo.db`，**沒有**「一資料夾＝一對話」。**1.8.1 起** `brainService.getKiloBrainStats()` 會以 `node:sqlite` 唯讀查 `session` 表取對話數（不支援時退回 `storage/session_share/*.json` 檔數），佔用空間取整個資料家目錄（含 `kilo.db`／`storage`／`snapshot`）；否則會顯示 0 筆／0 MB。清理仍只回收舊版 `globalStorage/kilocode.kilo-code/tasks/<id>/`，確認視窗會警告不動 `kilo.db`。
  - 回歸測試：`node antigravity-toolbox/tests/kilo-brain-stats.test.js`（K1–K4）。
  - Skills：沒有固定全域目錄，`~/.config/kilo/skills` 存在時優先，否則 `~/.agents/skills`；Rules／Plugins 指向 `~/.config/kilo/{rules,plugins}`（7.x 全域規範在 `kilo.jsonc` 的 `instructions`）。
  - 測試會固定 `XDG_CONFIG_HOME`／`XDG_DATA_HOME` 到夾具，否則會讀到測試機真實的 Kilo 資料。
- 樣式基準＝**toolbox** 的 `.flavor-chip`（`media/style.css`，2026-10-27 定案）；inspector 快照的 `.source-chip` 已對齊它（補 `font-family: inherit`／`white-space: nowrap`／`flex: 0 0 auto`，啟用態加 `font-weight: 600`，Cline 色值統一為 `.18`／`.5`）⇒ **改一邊必須同步改另一邊，以 toolbox 為準**。

### 8.2 toolbox 的 Skills 連結同步（`~/.agents/skills`）

> 這一節就是本技能「怎麼被叫用」的機制：repo 的 `.agents/skills/*` 由 toolbox 依工作區啟用狀態同步成 `%USERPROFILE%\.agents\skills` 的 junction。

- 流程：專案開關／批次操作 → `workspaceService.maybeSyncSkills()` → `skillSyncService.syncEnabledProjectSkills()` → `lib/skill-junction-sync.syncWorkspaceSkills()`；關閉**主開關**時走 `clearGlobalSkillLinks()`（**不分歸屬**、全部連結都解除，這是刻意的「關閉即收乾淨」）。
- **連結歸屬（2026-10-27 起，1.6.1）**：同步只會解除「指向本工作區註冊專案（`folders` ＋ `disabledFolders`）」或「目標已失效」的連結；指向其他工作區的連結一律保留（全域目錄是所有工作區共用的）。判定＝`syncWorkspaceSkills` 內每個連結的 `owned` 欄位，來源是 `options.workspacePaths`。
- **`allowEmpty`**：`maybeSyncSkills` 一律傳 `true`（剛寫入的 `folders` 是權威狀態）⇒ 最後一個專案被關掉（`folders` 變空）時解除本工作區連結；沒有工作區設定檔的路徑（`refreshSkillSync` 等）由 `resolveSyncScope()` 自動查 `disabledFolders`，查不到就沿用舊行為（跳過、保留連結，避免單資料夾視窗誤刪）。CLI（`scripts/sync-workspace-skills-cli.js`）同樣傳 `workspacePaths`，`disabledFolders > 0` 時 `allowEmpty: true`。
- `skipped` 只剩兩種：`empty-enabled`（無啟用專案且無歸屬資訊）、`empty-source`（0 來源**且沒有可回收的本工作區連結**）。
- 解除連結一律走 `fs.rmdirSync` 快路徑（目標內容不動，S11 有驗證），失敗才落回 `cmd /c rmdir`：⛔ 不要改回「每顆連結 spawn 一個 `cmd.exe`」——`spawnSync` 會同步阻塞擴充主機，十幾顆連結就足以讓語言伺服器（Pylance）通訊被判定中斷。
- 回歸測試：`node antigravity-toolbox/tests/skill-junction-sync.test.js`（工具層 S1–S11）＋ `node antigravity-toolbox/tests/skill-sync-service.test.js`（服務層 I1–I5，直接走 `maybeSyncSkills` 的真實呼叫鏈）；S3／I3 是「關掉最後一個專案」、S5／I4 是「只剩無 skills 專案」的殘留 bug。
- 反模式：把 `empty-source`／`empty-enabled` 當成「一律跳過」→ 殘留連結（1.6.0 的 bug）；用「掃到就刪」判定歸屬 → 多工作區互刪。

### 8.3 inspector 的規範分類（1.2.7 起）

- **分類依據＝Cline 4.x 真實行為**，不是檔名、也不是資料夾：`.clinerules/*.md`／`.cline/rules/*.md` 有 `paths:` frontmatter ⇒ **條件式**（Cline 依當前開著的檔／提到的路徑自動啟用，會跳「Conditional rules applied」）；沒有 `paths:` ⇒ **常駐**（每次對話注入）；`workflows/*.md` ⇒ **按需工作流程**（slash command 叫用才載入）。
- 實作鏈：`contextScannerService.parseFrontmatter()`（解析 `paths`：區塊清單／單行／行內陣列）→ `scanRulesInDir()`／`parseSingleRuleFile()`（帶出 `paths`／`hasPaths`）→ `scanClineSources()` → `_scanClineLayout()`（`.clinerules`＋`.cline/rules`、`.clinerules/workflows`＋`.cline/workflows`）→ `_toClineEntry()`（`kind`＝`always`／`conditional`／`workflow`、`trigger`＝`always_on`／`conditional_paths`／`workflow`）。
- UI：卡片標題維持「條件式規範 (Conditional)」（不改成「條件式 / 按需規範」，避免標題過長）；`kind === 'workflow'` 的項目在描述前加「工作流程 · 」作為唯一區分（`media/app.js`，i18n 鍵 `tag_kind_workflow` 三語）。
- ⛔ 反模式：把 `.clinerules` 根目錄一律標成常駐（1.2.6 以前）⇒ 帶 `paths:` 的檔案被顯示成常駐，與 Cline 實際載入狀況相反。
- **技能掃描必須接受 symlink／junction（1.2.8 起）**：`scanSkillsInDir()` 的子資料夾條件是 `entry.isDirectory() || entry.isSymbolicLink()`。Windows 的 `Dirent.isDirectory()` 對 junction（`mklink /J`）回傳 **false**、只有 `isSymbolicLink()` 為 true，而 §8.2 的 `~/.agents/skills/*` 正是 toolbox 同步出來的 junction ⇒ 1.2.7 以前全域技能整批掃不到（2026-10-31 實測 26 個掃到 0 個，症狀＝「技能清單只有專案技能、快照看不到 character-performance 這類全域技能」）。`scanRulesInDir()` 的 `.md` 檔案同理放寬。往後新增任何「掃目錄」的服務一律比照。
- 回歸測試：`node antigravity-ai-context-inspector/tests/cline-conditional-rules.test.js`（B0–B6）＋ `node antigravity-ai-context-inspector/tests/skill-junction-scan.test.js`（J0–J5，含 `Dirent.isDirectory()==false` 的負對照）。

### 8.4 inspector 的 Kilo 對話快照（1.3.0 起）

- **資料來源**：`~/.local/share/kilo/kilo.db`（SQLite）的 `session`／`message`／`part` 三表。Kilo 7.x 改用 opencode 架構，**沒有「一資料夾＝一對話」**，不可照抄 Cline 的資料夾掃描。
- **硬前提**：以 Node 內建 `node:sqlite` **唯讀**開啟；`KiloSessionService.isAvailable()` 同時檢查「模組可用」與「kilo.db 存在」，宿主 Node 太舊時 chip 直接不出現（不影響其他來源）。
- **清單**：只查 `session` 表，預設用 `session.directory` 比對目前工作區（`antigravity.aiContext.kiloScope=workspace|all`）；標題／時間／token／成本都取該表。
- **足跡**：選取對話後才讀 `part`，且 SQL 先以 `json_extract(data,'$.type') IN ('tool','patch')` 過濾，避免把 base64 圖片載入記憶體。`patch.files` 與工具輸入的路徑 → 規範；`skill` 工具 → 技能；**Kilo 的 MCP 工具是 `<server>_<tool>`（單底線）**，只能拿已知伺服器名稱做前綴比對，⛔ 不要沿用 Cline 的 `__` 切法。
- **模型顯示（1.3.1）**：`session.model` 是 **JSON 字串**（`{"id":…,"providerID":…,"variant":…}`），必須用 `_parseModel()` 正規化後只給 `id`；`providerID` 另存 `provider`。`session.model` 為空的舊對話退回 `message.data.modelID`（`_collectMessageModels()` 一次掃完）。⛔ 不要把原始 JSON 直接丟給 UI。
- **環境掃描**：`contextScannerService.scanLiveEnvironment(..., { kilo:true })` 會跳過 Antigravity 的 `~/.gemini` 全域設定，改掃 `AGENTS.md`、`.kilo/rules`、`.kilocode/rules`、`.agents/skills`（專案＋全域）。`.kilo/rules` 分類比照 Cline：有 `paths:` ⇒ 條件式、無 ⇒ 常駐。
- **MCP**：`McpDetectorService.scanKiloMcpServers()` 讀 `~/.config/kilo/kilo.jsonc` 的 `mcp` 段（`parseJsoncText` 剝除註解與尾逗號）＋ 專案 `.kilo/mcp.json`／`.kilocode/mcp.json`；不讀 `env`／`headers`／`auth.json`。
- 回歸測試：`node antigravity-ai-context-inspector/tests/kilo-snapshot.test.js`（K0–K3）。

### 8.5 mcp-manager 的 Kilo 狀態列（1.10.0 起）

- **資料來源**：`~/.config/kilo/kilo.jsonc` 的 `mcp` 段（XDG）；舊版相容 `~/.kilo`、`~/.kilocode`（只讀既有檔）。
- **可用性判定**：`KiloMcpService.isAvailable()`＝Kilo 擴充啟用 **或** 設定檔存在。⛔ 不要照抄 Cline 的「只看擴充」：Kilo CLI 可獨立存在，只看擴充會讓 CLI 使用者的狀態列永遠不出現。
- **啟停判定**：`enabled: false` 為停用（舊欄位 `disabled: true` 相容），缺欄位為啟用。`displayMode` 增加 `kilo`；`both` 會依序接上 Cline、Kilo。
- **JSONC**：`kilo.jsonc` 有註解與尾逗號，必須先剝除再 `JSON.parse`（`KiloMcpService.parseJsoncText`）。
- **隱私**：輸出白名單欄位，⛔ 不可 `...server` 展開，否則 `headers`／`environment`（可能含權杖）會進 UI；`auth.json` 一律不讀。
- **純檢視**：服務層無寫入 API；批次操作只作用於目前 IDE。1.10.1 起**移除檢視器入口**（`viewClineMcp`／`viewKiloMcp` 指令與快捷選單項目），統計只在狀態列與懸停視窗，設定檔改由快捷選單「設定檔」區塊開啟。
- 回歸測試：`node antigravity-mcp-manager/tests/kilo-mcp-service.test.js`（K1–K5）。

---

## 9. 首次建圖／重建（`graphify-out/` 不存在時）

```powershell
graphify --version                 # 需 0.9.x（本圖以 0.9.80 建立）
graphify extract . --code-only     # 純 AST，0 元
graphify cluster-only . --no-label # 產生 GRAPH_REPORT.md；--no-label 不呼叫 LLM
```

> ⛔ 沒有 `graphify-out/` 時**不可**直接 `graphify update .` —— 會生出只含變更檔的部分圖譜，且報告不會警示。
> 📌 根目錄 `.graphifyignore`（`*.md`）是必要的：`update` 沒有 `--code-only`，靠它維持「純程式架構圖」，避免 `AGENTS.md`／本技能／`README.md`／`docs/*.md` 變成 `document` 節點。**新增文件目錄不用改它**（`*.md` 已全部排除）；日後若加入其他會被抽取的副檔名（`.ts`／`.vue`）要重新評估語料範圍。

---

## 10. 反模式（踩過的坑）

| # | 反模式 | 後果 | 正確做法 |
| :-: | :--- | :--- | :--- |
| 1 | 沒確認 `graphify-out/` 就 `graphify update .` | 生出只含變更檔的**部分圖譜**，報告還不警示 | 依 §9 先 `extract --code-only` ＋ `cluster-only` |
| 2 | `explain "McpConfigService"` 不帶路徑 | 回 `Ambiguous`，被誤讀成「找不到」 | 用 `檔案::符號` 形式（§4 第一個 📌） |
| 3 | 改安裝邏輯卻去改各外掛的 `install-extension.ps1` | 那支是薄殼（只轉 `-Plugin`），等於沒改 | 改根 `install-all.ps1`／`uninstall-all.ps1`，再用單一外掛的 `.bat` 或 `-Plugin` 驗一次 |
| 4 | 靠 `$LASTEXITCODE` 判斷 `explain`／`query` 成敗 | 成功也回 `-1`，會被誤判為失敗 | 看輸出內容（§4 第二個 📌） |
| 5 | 把 `graphify-out/` commit 進版控 | 2.0 MB 產物、每次 `update` 都變動 | 維持 `.gitignore` 的排除 |
| 6 | `update` 用 `2>&1 \| Select-Object` 判成敗 | stderr warning 被當 `NativeCommandError` ⇒ exit 1 假失敗 | §5 第二個 📌：直接跑或看輸出末行 |
| 7 | 以為薄殼的 `-Target Prompt` 會問目標 IDE | install 薄殼把 `Prompt` 回溯相容為 `All`，一直等不到選單 | 要單一 IDE 用 `-Target Antigravity`／`VSCode`／`Cursor`；要看別的 IDE 資料用面板切換鈕 |
| 8 | 切換 `antigravity.uiFlavor` 卻沒清 `brainService` 快取 | 5 秒內顯示舊類別的對話統計 | 走面板切換鈕（`extension.js` 的 `setUiFlavor` 已處理），或自行呼叫 `invalidateCache()` |
| 9 | 以為 `auto` 會判定成 Cline | `resolveFlavor()` 的 auto 分支只看宿主 IDE，Cline 是外掛永遠不會命中 | 要顯示 Cline 只能手動切（chip 或設定值） |
| 10 | 想在切換鈕加回「全部／自動」 | 1.6.0 起刻意移除：未指定即等於跟隨宿主，多一顆鈕反而兩個狀態指同一件事 | 要回 `auto` 就點「目前宿主」那顆 chip |
| 11 | 新增外掛只改 `$candidatePool` | 漏 `$environmentExclusions`／`-Plugin` 對照／README 支援表 ⇒「裝了沒效果」或「選單有、實際不存在」 | 新增／移除外掛**同步 4 處**（§2 第 3 點） |
| 12 | Cline 快照用「目前開著的 `workspaceFolders`」掃規範／技能 | 開著 A 視窗看 B 對話時列出無關的 `AGENTS.md`／`.clinerules`；多根視窗全部列出 | 一律走 `ClineSessionService._snapshotRoots(target.workspaceRoot)`（inspector 1.2.6 起）；新來源服務比照「以對話自己的根目錄掃描」 |
| 13 | 把知識寫回 `AGENTS.md`、或又建 `docs/project-notes.md` 平行副本 | 兩份真相，改一邊忘一邊（2026-10-26／10-27 各發生過一次） | 知識只放技能（可多支）；`AGENTS.md` 只放索引；查閱型說明留 `README.md` |
| 14 | 對外宣稱支援 VSCodium | 實作只「偵測行程」、沒有部署目標 | 已定案不宣稱（2026-10-27）；要真支援得自行補根 2 支腳本（原 9 點清單見 git `6e34e44`） |
| 15 | 把 `.clinerules` 根目錄一律當常駐（或想靠檔名 `*cond*` 判斷條件式） | 帶 `paths:` 的條件式規範被顯示成常駐，與 Cline 實際載入相反，使用者誤判「規範沒生效」 | 只看 frontmatter：有 `paths:` ⇒ 條件式、無 ⇒ 常駐、`workflows/` ⇒ 按需（§8.3） |
| 16 | 掃技能／目錄時只認 `Dirent.isDirectory()` | Windows 的 junction 在 Dirent 是 `isSymbolicLink()=true`、`isDirectory()=false`；`~/.agents/skills/*` 全是 toolbox 同步的 junction ⇒ 全域技能整批消失（1.2.7 以前，實測 26→0） | 掃描條件一律寫 `isDirectory() \|\| isSymbolicLink()`，並用 `skill-junction-scan`（J0–J5）守住（§8.3） |


> 這些都是**實際失敗過**才寫上來的（2026-10-24～10-31），不是假設性風險。

---

## 11. 本技能維護

- 本技能＝這個 repo 的**專案知識主技能**：常數、授權、耦合表、邊界、反模式在這裡；根 `AGENTS.md` 只做**索引＋每輪必做**（技能索引／讀圖／收尾授權／知識落點），**不承載知識**。
- **可擴充（設計前提）**：repo 之後會再加其他技能（UI／安裝流程／i18n／測試…）。新增時三件事：① 同步補 `AGENTS.md` 的技能索引 ② 在該技能 §1 寫清與本技能的分流（何時用誰）③ 同一條規則不得在兩支技能各留一份。
- **取捨（要對使用者誠實）**：若技能沒被叫用，§5 的授權與 §6／§7 的鐵律都不在 context；`AGENTS.md` 的技能索引就是為了把「先叫用技能」變成每輪可見的指令，⛔ 不要把它刪掉。
- 通用圖譜流程不重複抄寫（指向 `graphify-knowledge-graph`）；本檔只管**這個 repo** 的常數與授權。
- §3 與 §8 的數字會過期：**更新圖譜後順手更新並改日期**；無法確認就寫「查法」而不是寫死。
- 查閱型內容（完整檔案地圖、使用者向安裝說明）留在 `README.md`，本檔最多一行指標。
- 本檔刻意不含絕對磁碟路徑，repo 搬移或複製到別台機器後仍有效。

### 變更記錄

| 日期 | 變更 | 來源 |
| :--- | :--- | :--- |
| 2026-11-04 | toolbox `1.8.1 → 1.8.2`＝**手動「重新對齊」改為權威模式**：`lib/skill-junction-sync.js` 的 `syncWorkspaceSkills` 新增 `reclaimAll`（忽略 `workspacePaths` 歸屬、全域目錄內連結一律可回收），`skillSyncService.refreshSkillSync` 帶 `reclaimAll: true`。根因＝專案被**整個**移出工作區（拖出即移除／手動刪 `folders`）後，連結目標已不在任何註冊路徑內，舊版歸屬判定永遠認不出來 ⇒ 按幾次 ↻ 都留著；`workspaceService.maybeSyncSkills` 預設帶 `reclaimAll`（**面板操作＝權威**：專案開關／批次／首項／全部／反轉／拖出移除都會順手清孤兒；只有背景 Skills 目錄監看維持保守），`setSyncEnabled(true)`／`setExcludeFirstProject` 亦同；新增 `skillSyncService.alignWorkspaceSkillsNow()`／`scheduleWorkspaceAlign()` 並接上 `onDidChangeWorkspaceFolders` 與 `.code-workspace` 檔監看（700ms 防抖＋1.5s quiet window，避免與面板同步重複），**VS Code 原生「加入／移除工作區資料夾」也會自動對齊**；`removeWorkspaceFolder` 另以 `extraOwnershipPaths` 立即回收被移除專案的連結（不再製造孤兒）。`skill-junction-sync` 測試加 S12／S13、`skill-sync-service` 加 I6／I7／I8／I9 | 使用者回報：多專案工作區按「重新整理 Skills 連結」後，`~/.agents/skills` 仍有當前工作區未載入的技能 |
| 2026-11-02 | mcp-manager `1.10.0 → 1.10.1`＝**移除 Cline／Kilo 檢視器入口**：快捷選單不再有「檢視 … MCP 伺服器狀態」、移除 `antigravity.mcp.viewClineMcp`／`viewKiloMcp` 指令與檢視器程式、清掉對應三語鍵；統計與「開啟設定檔」保留 | 使用者回報：快捷選單不需要檢視功能 |
| 2026-11-02 | mcp-manager `1.9.3 → 1.10.0`＝**狀態列新增 Kilo 統計（純檢視）**：`services/kiloMcpService.js` 讀 `~/.config/kilo/kilo.jsonc`（JSONC、`mcp` 段、`enabled:false` 判定）、`displayMode` 加 `kilo`、狀態列／懸停／快捷選單／檢視器／檔案監聽與 `antigravity.mcp.viewKiloMcp` 指令；三語文案；新增 `kilo-mcp-service`（K1–K5）測試，測試總數 14→15 支；圖譜 1875→**1912** 節點／3375→**3434** 邊／118→**115** 社群（commit `c94c6569`） | 使用者需求：下方工具列也要能顯示 Kilo（目前顯示 MCP (Cline)） |
| 2026-11-02 | inspector `1.3.0 → 1.3.1`＝**Kilo 對話模型顯示正規化**：`session.model` 是 JSON 字串，新增 `_parseModel()` 只取 `id`、`providerID` 另存 `provider`；`session.model` 為空時由 `_collectMessageModels()` 退回訊息中的模型；非 Antigravity 來源缺模型改顯示 `—`（不再誤顯示 Gemini Flash）。`kilo-snapshot` 補 K1／K2 斷言；圖譜 1873→**1875** 節點／3371→**3375** 邊／116→**118** 社群 | 使用者回報：對話使用模型顯示成 JSON 字串太雜亂 |
| 2026-11-02 | inspector `1.2.8 → 1.3.0`＝**新增 Kilo 對話快照來源**：`services/kiloSessionService.js` 以 `node:sqlite` 唯讀查 `kilo.db`（session 清單／part 足跡），`contextScannerService` 加 `kilo` 佈局（AGENTS.md／.kilo/rules／.agents/skills，跳過 ~/.gemini），`mcpDetectorService` 加 `scanKiloMcpServers`（JSONC 解析）＋ `kiloScope` 設定＋黃色 `src-kilo` chip；新增 `kilo-snapshot`（K0–K3）測試，測試總數 13→14 支；圖譜 1815→**1873** 節點／3270→**3371** 邊／113→**116** 社群（commit `f9cc2b6b`） | 使用者需求：最近對話快照也要能看 Kilo |
| 2026-11-02 | toolbox `1.8.0 → 1.8.1`＝**Kilo 對話統計修正**：新增 `brainService.getKiloBrainStats()`，以 `node:sqlite` 唯讀查 `kilo.db` 的 `session` 表（不支援時退回 `storage/session_share/*.json` 檔數），佔用空間取整個 `~/.local/share/kilo`；修正 Kilo 卡片顯示 0 筆／0 MB。chip 顏色由琥珀改**黃 `#ffd54f`**；新增 `kilo-brain-stats`（K1–K4）測試，測試總數 12→13 支；圖譜 1791→**1815** 節點／3233→**3270** 邊／108→**113** 社群 | 使用者回報：Kilo 對話記憶庫顯示 0 MB（實測 8 筆／58.4 MB），且 chip 想改黃色 |
| 2026-11-02 | toolbox `1.7.0 → 1.8.0`＝**新增第五個資料類別 `kilo`**：`systemService` 加 `getKiloConfigHome`／`getKiloDataHome`／`getKiloExtensionStorageDir`／`resolveKiloTasksDir`／`resolveKiloMcpConfigPath` 與 `getGlobalPaths('kilo')`、`collectBrainSessionDirs('kilo')`、`getEnvironmentInfo().flavors.kilo`；`brainService` 加 `isKiloHost()` 與 SQLite 警示；UI 加琥珀 chip、三語鍵；`handleOpenTarget('mcpConfig')` 對 `.jsonc` 缺檔改為只開資料夾；`environment-flavor` 測試新增 E1–E5（24 項）並固定 XDG 環境變數；圖譜 1779→**1791** 節點／3204→**3233** 邊／105→**108** 社群（commit `f6d880b2`） | 使用者需求：toolbox 目前有 Antigravity／Copilot／Cursor／Cline，要再加 Kilo |
| 2026-10-31 | inspector `1.2.7 → 1.2.8`＝**技能掃描支援 symlink／junction**：`scanSkillsInDir()` 子資料夾條件由 `entry.isDirectory()` 改為 `isDirectory() || isSymbolicLink()`，`scanRulesInDir()` 的 `.md` 比照放寬。根因＝Windows `Dirent.isDirectory()` 對 junction 回傳 false，而 `~/.agents/skills/*` 正是 toolbox 同步的 junction ⇒ 1.2.7 以前全域技能整批掃不到（實測 26 個→0 個，只剩 `.claude/skills` 的實體資料夾）；Cline 快照因而只顯示專案技能。新增 `skill-junction-scan`（J0–J5）測試，測試總數 11 → 12 支；圖譜 1755→**1779** 節點／3170→**3204** 邊／101→**105** 社群（Built from commit `7493df6a`） | 使用者回報：Cline 快照的技能清單只有專案技能，`C:\\Users\\User\\.agents\\skills` 的技能沒出現，懷疑沒被引用 |

| 2026-10-31 | inspector `1.2.6 → 1.2.7`＝**規範分類對齊 Cline 真實行為**：`parseFrontmatter` 解析 `paths`（區塊／單行／行內陣列）、`scanRulesInDir`／`parseSingleRuleFile` 帶出 `paths`／`hasPaths`、`scanClineSources` 改走 `_scanClineLayout`（新增 `.cline/rules`、`.cline/workflows`）＋`_toClineEntry`（`kind`＝always／conditional／workflow）；卡片標題維持「條件式規範 (Conditional)」（不改成「條件式 / 按需規範」，避免標題過長），改以項目描述的「工作流程 · 」前綴區分按需工作流程（三語）；新增 `cline-conditional-rules`（B0–B6）測試，測試總數 10 → 11 支；圖譜 1735→**1755** 節點／3139→**3170** 邊／107→**101** 社群 | 使用者回報 `.clinerules/condition.md` 顯示為常駐、但 Cline 依 `paths:` 判斷並未載入（條件式規範被誤標） |
| 2026-10-28 | toolbox `1.6.2 → 1.7.0`＝**拖出即移除**：`startCardPointerInteraction()` 判定拖出 webview 邊界（座標＋`pointerout`／`mouseleave` 逸出）→ 顯示 `#drag-remove-overlay` → 放手送 `removeWorkspaceFolder`；`workspaceService.removeWorkspaceFolder()` 同步清 `folders`／`disabledFolders`／`folderOrder`（`syncFolderOrder()` 重建、立即寫檔、不刪磁碟），只在 `hasMultiRoot` 生效；新增 `workspace-remove`（R1–R6）測試；圖譜 1710→**1735** 節點／3094→**3139** 邊／101→**107** 社群（commit `c5443cfb`） | 使用者需求：多專案工作區要能拖出框架移除專案 |
| 2026-10-28 | toolbox `1.6.1 → 1.6.2`＝**工作區重複登記自癒**：新增 `dedupeWorkspaceItems()`（跨清單以啟用優先）、`analyzeWorkspace()` 自癒＋`deduplicatedCount`、切換開關前先去重、`syncFolderOrder()` 改唯一集合比對（修掉「有重複就每輪空寫工作區檔」）；新增 `workspace-dedupe`（D1–D5）測試；命令改名「自動修正工作區重複專案（同名＋重複登記）」；圖譜 1689→**1710** 節點／3056→**3094** 邊／103→**101** 社群（commit `5e5ea2e0`） | 使用者回報：重複「加入資料夾」後面板出現兩份專案 |
| 2026-10-28 | `AGENTS.md` 改為**條例式技能索引**（740 → 約 640 字元、15 → 10 行）：不再綁死單一技能，改寫成「技能索引／先讀圖／收尾授權／知識落點」四條；§1 叫用方式、§11 維護段同步改為「主技能＋可擴充」 | 使用者指示：AGENTS 要極度精簡易讀，且日後會新增其他技能 |
| 2026-10-28 | **架構回到「派送句 ＋ 本技能」**（第二次切換）：由 `AGENTS.md`（2,029 字元）拆回本檔，並把 `docs/project-notes.md`（§3–§12）整併進來後**刪除**（回收筒）；§3 改記 1689／3056／103 與「`update` 回 no topology changes ⇒ 標記落後但內容一致」；新增 §5 的 `2>&1` 假失敗坑、§10 第 6／11／13 條 | 使用者指示：知識收回技能，`AGENTS.md` 只留進場指引 |
| 2026-10-27 | 圖譜 1642→**1689** 節點、2976→**3056** 邊、98→**103** 社群；`Built from commit` `fb64d432` | 收尾依 §5 執行 `graphify update .` |
| 2026-10-27 | toolbox `1.6.0 → 1.6.1`＝修正「關掉最後一個專案後 `~/.agents/skills` 仍殘存 Skills」：新增連結歸屬（`workspacePaths`）與 `allowEmpty`、`skipped` 收斂成 2 種、解除連結改走 `fs.rmdirSync`；新增 `skill-junction-sync`（S1–S11）＋`skill-sync-service`（I1–I5）測試 | 使用者回報殘留連結 |
| 2026-10-27 | inspector `1.2.5 → 1.2.6`＝Cline 快照改以「該對話自己的工作區」掃描（`_snapshotRoots`）；測試 10 → 12 項 | 使用者回報快照常駐規範判斷不正確 |
| 2026-10-27 | VSCodium **定案不支援**：移除對外宣稱與待辦文件（偵測碼保留） | 使用者指示：不支援就不要寫在描述裡 |
| 2026-10-26 | 由 repo 根 `AGENTS.md` 全文改寫成技能；根 `AGENTS.md` 瘦身為進場指引 | 使用者指示 |
