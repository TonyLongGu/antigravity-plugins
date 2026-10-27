# antigravity-plugins：專案細節備忘（非每輪必讀）

> 用途：`AGENTS.md` 只留「概況 ＋ 讀圖／更新圖 ＋ 紅線」；細節放本檔，**不進每輪 context**。
> **讀圖／更新的規則以 [`AGENTS.md`](../AGENTS.md) 為準**，不要從本檔抄。
> 來源：2026-10-27 由 `AGENTS.md` 全文拆出（章節編號沿用原文，故從 §3 起）。

---
## 3. 這個 repo 是什麼

單一 git repo，內含 **6 個獨立 VS Code 擴充套件** ＋ 根目錄安裝腳本（`install-all.ps1`／`uninstall-all.ps1` 及 `.bat` 包裝）。六個外掛都貢獻給同一組「Antigravity IDE 的 AI 工具鏈」，但**互不 import**。

- **沒有程式碼共用**：實測 2,974 條邊只有 **1 條**「跨外掛」（且是 `node:sqlite` builtin 的誤判）。真正的耦合是 **VS Code command id 字串**，見 §7。
- **安裝邏輯只有 2 支腳本**：各外掛的 `install-extension.ps1`／`uninstall-extension.ps1` 自 2026-10-26 起是**薄殼**（各 ~47 行，`.bat` 不動），只把自己的資料夾名稱當 `-Plugin` 轉呼叫根腳本 ⇒ 改一次 6 個外掛同時生效（改版前是 6 份各差 3～4 行的複本，得人工同步）。
- **安裝政策（2026-10-26 起）＝一鍵全裝**：根 `install-all.ps1` 的 `-Target` 預設 `All`、`-Plugin` 省略＝全部外掛（可給資料夾名稱或 `package.json` 的 `name`，例：`-Plugin antigravity-quota-status` 或 `-Plugin ai-quota-status`）。目標 IDE 由腳本自動偵測，使用者改在控制中心頂部的「類別切換鈕」決定要看哪一套 IDE 的資料；不相容組合由根腳本的 `$environmentExclusions` 自動略過。
- **測試**：各外掛 `tests/*.test.js`（零相依，直接 `node <檔案>` 跑，無框架）。現有 6 支：`antigravity-toolbox/tests/{environment-flavor,mcp-label}.test.js`、`antigravity-ai-context-inspector/tests/{cline-snapshot,mcp-vscode-sources,snapshot-source-default}.test.js`、`antigravity-mcp-manager/tests/agent-host-enablement.test.js`。動到 flavor 判定或 i18n 鍵一定要跑對應那支。
- **webview 前端**在 `media/`（inspector／mcp-manager／quick-access／script-runner／toolbox），**不進圖**。

---

## 4. 安裝／卸載腳本鐵律

| # | 規則 | 理由 |
| :-: | :--- | :--- |
| 1 | 改安裝／卸載邏輯**只改根目錄** `install-all.ps1`／`uninstall-all.ps1` | 外掛內那 12 支是薄殼，改了等於沒改（§10 反模式） |
| 2 | `-Target` 預設 `All`；`Prompt` 在根腳本是**互動選單**，在 install 薄殼回溯相容為 `All`、uninstall 薄殼仍是選單 | 2026-10-26「一鍵全裝」定案 |
| 3 | 新增／移除外掛要同步 4 處：根腳本 `$candidatePool`、`$environmentExclusions`、`-Plugin` 對照、本檔 §8＋根 `README.md` 支援表 | 漏一處就出現「裝了沒效果」或「選單有、實際不存在」 |
| 4 | `quota-status` 不進 VS Code（`$environmentExclusions`） | VS Code 沒有額度 API |
| 5 | **VSCodium 不支援**（2026-10-27 定案）：根腳本只有 `Get-RunningIdeForRoot()` 的行程偵測，**沒有任何部署目標** ⇒ 對外一律不宣稱（README 警語與 `package.json` 描述均已移除） | 偵測碼保留給「手動掛載」情境用（抓對 User 路徑／IDE 執行警告），不等於已支援 |
| 6 | 腳本不得寫死本機磁碟路徑；`install-all.ps1` 的 `.bat` 包裝只用 `-ExecutionPolicy Bypass` 呼叫 PS1 | 可遷移性；repo 要能搬機器 |

---

## 5. 圖譜快照（2026-10-27 實測，graphify 0.9.80）

| 項目 | 值 |
| :--- | :--- |
| 圖譜位置 | `graphify-out/`（根 `.gitignore` 已排除，**勿 commit**） |
| 規模 | **1641** nodes / **2974** edges / **97** communities（60 顯示、37 thin 省略） |
| 建圖 | `graphify update .`（2026-10-27；前一版 1631／2961／96、commit `5b154c85`） |
| `Built from commit` | `1e823015`（＝HEAD；更新時工作區另有未提交的 toolbox 變更，故圖反映**工作區**現況） |
| 語料 | 102 files · ~132,830 words；30 檔未進圖（`.bat` 14、無副檔名 10、`.css` 6） |
| 抽取品質 | 95% EXTRACTED／5% INFERRED（142 邊，平均信心 0.85）；**0 input/0 output token＝0 元** |
| 產物大小 | `GRAPH_REPORT.md` **17.2 KB**（可整讀）、`graph.json` **2.0 MB**（禁整讀）、`graph.html` 約 1.6 MB |
| 節點分佈 | script-runner 455／inspector 341／toolbox 301／mcp-manager 265／quota-status 174／quick-access 79／根目錄 17（＋2 支根腳本各 4）／`node:sqlite` 1 |
| 不進圖 | `*.css`、`*.html`、`locales/*.json`、`*.md`（`.graphifyignore` 已排除 `*.md`） |

> ⚠️ 上表是**快照**。用前先驗兩件事：`GRAPH_REPORT.md` 的 `## Summary` 數字、以及 `Built from commit` 是否＝`git rev-parse --short=8 HEAD`；任一對不上就當「已過期」，依 §2 重跑。
> 📌 節點分佈的一行查法（不整檔讀圖）：
> ```powershell
> node -e "const m={};for(const n of require('./graphify-out/graph.json').nodes){const k=(n.source_file||'').split('/')[0]||'(root)';m[k]=(m[k]||0)+1}console.log(m)"
> ```

---

## 6. 這張圖的邊界

| 抓得到（附 `檔名:行號`） | 抓不到 |
| :--- | :--- |
| 類別／方法呼叫、`require`、繼承、`package.json` contributes | 跨外掛 **command id 字串**（§7 人工維護）、`workbench.view.extension.<container>` |
| PowerShell 函式（實測 `.ps1` 有節點） | `.css`／`.html`／DOM id、`locales/*.json` 的 i18n 鍵 |
| 檔案 → 符號 → 社群歸屬 | runtime 動態呼叫、`env` 等設定資料 |

> ⚠️ **同名 helper 只剩 2 份**（2026-10-26 薄殼化後）：`Get-RunningIdeForRoot()`、`Test-IsOwnExtensionArtifact()` 僅存在於根 `install-all.ps1`／`uninstall-all.ps1`，12 支外掛薄殼不含 helper。`explain` 可能回多筆同 label ⇒ 用 `source_file` 辨識；改安裝邏輯只需同步這 2 支。（查法：`Select-String -Path *\install*.ps1,uninstall*.ps1 -Pattern 'function Get-RunningIdeForRoot'`）

> ℹ️ **18 個 code 檔「掃到但零符號」**屬正常：12 支薄殼 `install-extension.ps1`／`uninstall-extension.ps1` 只剩語句沒有函式，＋ `media/*/locales.js` 的 i18n 資料表、`quota-refresh-trigger.ps1` 等。`update` 每次都會印 stderr warning（`$LASTEXITCODE` = 0），⛔ 不要為此改腳本或加旗標。

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

## 8. 六外掛速查

> 版本＝2026-10-27 讀 `package.json` 實測；節點＝本次圖譜實測貢獻數。兩者都會過期 ⇒ 版本看各外掛 `package.json` 的 `version`，節點用 §5 的查法。

| 外掛 | 版本 | 節點 | 對外 id 家族 | view／container | 進入點／服務 |
| :--- | :--- | ---: | :--- | :--- | :--- |
| `antigravity-script-runner` | 1.7.1 | 455 | `scriptRunner.*`（8 個 id × `.en`／`.cn`＝24） | 無 view（右鍵選單＋媒體檢視） | `extension.js`／6 services（audio／video／image／stream） |
| `antigravity-ai-context-inspector` | 1.2.4 | 341 | `antigravity.aiContext.*`（3 ＋ `.en`） | `antigravity.aiContextView`／`antigravity-ai-context-container` | `extension.js`／6 services（cline·cursor·vscode chat／contextScanner／mcpDetector） |
| `antigravity-toolbox` | 1.6.0 | 301 | `antigravity.toolbox.*`（7 ＋ 4 `.en`） | `antigravity.toolboxView`／`antigravity-toolbox-container` | `extension.js`／6 services（brain／copilotChat／skillSync／workspace…） |
| `antigravity-mcp-manager` | 1.9.3 | 265 | `antigravity.mcp.*`（6 ＋ `.en`） | `antigravity.mcpManagerView`／`mcp-manager-container` | `extension.js`／9 services |
| `antigravity-quota-status` | 1.1.0（`name`＝`ai-quota-status`） | 174 | `aiQuota.*`（7，無變體） | 無 view（狀態列） | `extension.js`／4 services（quota／cursorAuth…） |
| `antigravity-quick-access` | 1.2.6 | 79 | `antigravity.quickAccess.*`（20 × 3＝60） | `antigravity.quickAccessView` | `extension.js`／無 `services/` 目錄 |

> 六個外掛都是 `main: ./extension.js`、CommonJS；`engines.vscode` 除 quota-status（`^1.68.0`）外皆 `^1.80.0`（2026-10-26）。

### 8.1 toolbox 的資料類別（flavor）切換

- 判定集中在 `antigravity-toolbox/services/systemService.js`：`getFlavorOverride()`（讀 `antigravity.uiFlavor`）→ `resolveFlavor()` → `getGlobalPaths(flavor)`／`collectBrainSessionDirs(flavor)`；`brainService` 以 `resolveFlavor()` 決定走 Brain 或 Copilot 分支。**切換類別後必須呼叫 `invalidateCache()`**（5 秒快取，否則顯示舊類別）。
- 回歸測試：`node antigravity-toolbox/tests/environment-flavor.test.js`；i18n 鍵改動跑 `node antigravity-toolbox/tests/mcp-label.test.js`。
- 切換鈕（1.6.0 起）＝**彩色 chips**，順序固定 `Antigravity` → `Copilot` → `Cursor` → `Cline`（不隨宿主變動）：`Antigravity`（綠 `#4ec9b0`）／`Copilot`（藍 `#9cdcfe`）／`Cursor`（橘 `#ce9178`）／`Cline`（紫 `#c586c0`）。只在啟用態上色、**不顯示對話筆數**（`flavorCounts`／`getFlavorSessionCounts` 已於 1.6.0 移除，勿再加回）。
- **已無「自動」鈕**：未指定時以 `autoFlavor` 為作用中，點「目前宿主」那顆 chip 即回寫 `auto`。
- `cline` 是**外掛而非宿主**（`auto` 永遠不會命中，只能手動點）。路徑見 `systemService.getGlobalPaths('cline')`：`~/.cline`，MCP 在 `data/settings`、對話在 `data/sessions`（舊版退回 `globalStorage/saoudrizwan.claude-dev/tasks`）。⚠️ 清理 Cline **只刪 session 資料夾**，不動 `data/db/*.db`（Cline 介面可能仍列出已刪項目）。
- 樣式來源＝inspector 快照的 `.source-chip`（`media/style.css`）⇒ 改一邊要同步看另一邊。

## 9. 首次建圖／重建（`graphify-out/` 不存在時）

```powershell
graphify --version                 # 需 0.9.x（本圖以 0.9.80 建立）
graphify extract . --code-only     # 純 AST，0 元
graphify cluster-only . --no-label # 產生 GRAPH_REPORT.md；--no-label 不呼叫 LLM
```

> ⛔ 沒有 `graphify-out/` 時**不可**直接 `graphify update .` —— 會生出只含變更檔的部分圖譜，且報告不會警示。
> 📌 本 repo 根目錄的 `.graphifyignore`（`*.md`）是必要的：`update` 沒有 `--code-only`，靠它維持「純程式架構圖」，避免 `AGENTS.md`／`README.md`／`docs/*.md` 變成 `document` 節點。**新增文件目錄時不用改它**（`*.md` 已全部排除）；但若日後加入其他會被抽取的副檔名（如 `.ts`、`.vue`）要重新評估語料範圍。

---

## 10. 反模式（踩過的坑）

| 反模式 | 後果 | 正確做法 |
| :--- | :--- | :--- |
| 沒確認 `graphify-out/` 就 `graphify update .` | 生出只含變更檔的**部分圖譜**，報告還不警示 | 依 §9 先 `extract --code-only` ＋ `cluster-only` |
| `explain "McpConfigService"` 不帶路徑 | 回 `Ambiguous`，被誤讀成「找不到」 | 用 `檔案::符號` 形式（§1 第一個 📌） |
| 改安裝邏輯卻去改各外掛的 `install-extension.ps1` | 那支是薄殼（只轉 `-Plugin`），等於沒改 | 改根 `install-all.ps1`／`uninstall-all.ps1`，再用單一外掛的 `.bat` 或 `-Plugin` 驗一次 |
| 靠 `$LASTEXITCODE` 判斷 `explain`／`query` 成敗 | 成功也回 `-1`，會被誤判為失敗 | 看輸出內容（§1 第二個 📌） |
| 把 `graphify-out/` commit 進版控 | 2.0 MB 產物、每次 `update` 都變動 | 維持 `.gitignore` 的排除 |
| 以為薄殼的 `-Target Prompt` 會問目標 IDE | install 薄殼自 2026-10-26 起把 `Prompt` 回溯相容為 `All`，一直等不到選單 | 要單一 IDE 用 `-Target Antigravity`／`VSCode`／`Cursor`；要看別的 IDE 資料用面板切換鈕 |
| 切換 `antigravity.uiFlavor` 卻沒清 `brainService` 快取 | 5 秒內顯示舊類別的對話統計 | 走面板切換鈕（`extension.js` 的 `setUiFlavor` 已處理），或自行呼叫 `invalidateCache()` |
| 以為 `auto` 會判定成 Cline | `resolveFlavor()` 的 auto 分支只看宿主 IDE，Cline 是外掛永遠不會命中 | 要顯示 Cline 只能手動切（chip 或設定值） |
| 想在切換鈕加回「全部／自動」 | 1.6.0 起刻意移除：未指定即等於跟隨宿主，多一顆鈕反而兩個狀態指同一件事 | 要回 `auto` 就點「目前宿主」那顆 chip |
| 改了 `.js`／`.ps1` 卻沒跑 `update`、或沒更新 §5 快照 | 下一輪照著舊圖做決策、數字互相矛盾 | 依 §2 收尾 |
| 把知識寫回技能檔、或又建 `<repo>-maintenance` 技能 | 兩份真相，改一邊忘一邊（2026-10-26 就發生過一次） | 知識只放**本檔**；文件放 `docs/`，程式地圖放 §8 |
| 對外宣稱支援 VSCodium | 實作只「偵測行程」、沒有部署目標 | 已定案不宣稱；要真支援得自行補根 2 支腳本（原待辦清單已刪，見 git `6e34e44`） |

---

## 11. 未結案

| 主題 | 現況 | 文件 |
| :--- | :--- | :--- |
| ——（目前無未結案項目） | VSCodium 已於 2026-10-27 定案不支援，待辦文件同時移除；需要那份「9 個修改點」清單時從 git 取回：`git show 6e34e44:docs/vscodium-support-gap.md` | — |

---

## 12. 本檔維護

- **本檔＝這個 repo 的唯一真相**：常數、授權、耦合表、邊界、反模式全在這裡；不要再建同名技能，也不要把同一條規則寫進 `README.md`（README 只寫使用者導向的安裝／功能說明）。
- **放入判準**：只有「每輪都可能要遵守」的規則才放本檔；純查閱型的長表格（例：完整檔案地圖）若膨脹到影響可讀性，才外移到 `docs/` 並在此留一行指標。
- **會過期的數字**：一律「快照 ＋ 日期 ＋ 查法」三件套（§5／§8 已照此寫）；給不出查法就不要寫死。
- **搬移性**：本檔不含絕對磁碟路徑（`~` 與相對路徑除外），repo 搬機器後仍有效。
- **與全域衝突**：harness／工作區的全域規範優先；本檔只補這個 repo 的領域知識。

### 變更記錄

| 日期 | 變更 | 來源 |
| :--- | :--- | :--- |
| 2026-10-27 | **知識回歸本檔**：`.agents/skills/antigravity-plugins-maintenance/` 退役（含 `references/`），內容整併成 §1–§12；新增「動工前讀圖譜（§1）／動工後更新圖譜（§2）」兩個必做時點；VSCodium 待辦移至 `docs/vscodium-support-gap.md` | 使用者指示：不再用技能維護專案，統一用 `AGENTS.md` 描述架構與規範 |
| 2026-10-27 | 圖譜更新：1631→**1641** 節點、2961→**2974** 邊、96→**97** 社群；`Built from commit` `5b154c85`→`1e823015`（＝HEAD） | 收尾依 §2 執行 `graphify update .` |
| 2026-10-27 | inspector `1.2.3 → 1.2.4`＝快照對話清單**移除來源徽章**（`.conv-source-badge` 與 4 個 `src-*` 樣式一併刪除）：上方來源 chips 已表達類別，清單只留標題與時間；來源改放項目 tooltip 供辨識 | 使用者指示：清單不用再顯示 Cursor 等工具標籤 |
| 2026-10-27 | VSCodium **定案不支援**：清除最後一處對外宣稱——toolbox `package.json` 的 `description` 移除 `VSCodium`（README 2026-10-26 已改為「尚未支援」警語）；**偵測碼保留不動**（`systemService` host 偵測／`clineMcpService` `ideNames`／根 2 支腳本 `$processMap`），否則手動掛載時面板會抓錯 User 路徑 | 使用者指示：外掛不支援就不要寫在描述裡 |
| 2026-10-27 | VSCodium **收尾**：移除 `antigravity-toolbox/README.md` 的「⚠️ 尚未支援自動掛載」警語、刪除 `docs/vscodium-support-gap.md`（含 9 點實作清單，需時自 git `6e34e44` 取回）；`AGENTS.md` §4、本檔 §3／§10／§11 的引用同步移除 ⇒ repo 內只剩偵測碼含 `vscodium` | 使用者指示：不支援就刪掉相關描述與文件 |

| 2026-10-26 | mcp-manager `1.9.2 → 1.9.3`＝**移除「編輯說明」**：卡片不再顯示用途說明與編輯器（`server-action-bar`／`server-desc-*`／`btn-edit-desc`、chevron 一併移除、summary 改 `cursor: default`），後端移除 `updateServerDescription`／`saveNotes` 與對應訊息、fingerprint 不再納入 description，i18n 3 語系各刪 7 鍵；既有 sidecar 備註改為唯讀相容（`getNotes()` 保留，Cline 檢視器仍顯示） | 使用者指示 |
| 2026-10-26 | inspector `1.2.2 → 1.2.3`＝快照來源 chips **預設選中宿主原生來源**：未手動選擇前一律跟隨宿主（`_sourceFilter = null`），點過 chip 後寫入 workspaceState `aiContext.sourceFilter` 並沿用（含再點一次＝顯示全部）；換來源時自動取該來源最新對話 | 使用者指示 |
| 2026-10-26 | 安裝政策改為「一鍵全裝」：7 份 PS1 的 `-Target` 預設 `Prompt` → `All`、`Prompt` 降為別名；toolbox 新增 `antigravity.uiFlavor` 與面板類別切換鈕（`resolveFlavor`／`getGlobalPaths(flavor)`／`invalidateCache`）；新增 `tests/environment-flavor.test.js` | 使用者需求：安裝檔整合為一、面板內切換 IDE 類別 |
| 2026-10-26 | 12 支外掛安裝腳本改為**薄殼**（安裝邏輯收斂到根 2 支，新增 `-Plugin`） | 使用者需求：安裝邏輯只留一份 |
| 2026-10-26 | 切換鈕定案：toolbox `1.5.0 → 1.6.0`＝inspector 風格彩色 chips（各類別一色、移除對話筆數徽章 `flavorCounts`）、新增 `cline` 類別；inspector `1.2.1 → 1.2.2`＝移除快照來源的「全部」chip 與筆數徽章；toolbox 測試 13 → 19 項 | 使用者指示 |
| 2026-10-26 | 知識一度收斂到 `.agents/skills/antigravity-plugins-maintenance/`（本檔曾瘦身為派送句）；2026-10-27 已回退，見第一列 | 使用者指示（後已改回單一 `AGENTS.md`） |

