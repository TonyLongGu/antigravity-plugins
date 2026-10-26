---
name: antigravity-plugins-maintenance
description: 維護 antigravity-plugins（6 個 VS Code 擴充套件同一個 repo）的專案知識：圖譜讀取紀律、改完自動更新授權、跨外掛 command id 耦合、六外掛速查、安裝腳本同步。當在此 repo 工作、要改安裝腳本或 command id、要查外掛結構與節點數、要重建圖譜，或提到 scriptRunner.*／antigravity.toolbox.* 時觸發。
---

# antigravity-plugins：專案維護（Antigravity Plugins Maintenance）

> 一句話：**這個 repo 的「事實」都集中在這裡；但事實會過期——§3 的數字一律先驗證再用。**
> 分工：圖譜的**通用流程**（何時建、怎麼驗、怎麼回報）→ skill `graphify-knowledge-graph`（在別的技能包，本 repo 未必載入；沒載入就用 §4／§9 的自足版本）。本技能只管**這個 repo 的常數、耦合與授權**。

---

## 1. 快速觸發

| 類型 | 內容 |
| :--- | :--- |
| **正例** | 「antigravity-plugins 的安裝腳本要加 VSCodium 支援」／「quota-status 現在幾個節點？」 |
| **正例** | 「改 `scriptRunner.runBat` 這個 id 會壞什麼？」／「這個 repo 的圖譜過期了嗎？」 |
| **負例** | 「幫我建一份知識圖譜」→ 走 `graphify-knowledge-graph`（本技能不含通用建圖步驟） |
| **負例** | 「這台機器做個環境健檢」、「幫我刪掉這些暫存檔」→ 走 `health-check`／`safe-delete` |
| **怎麼被叫用** | repo 根 `AGENTS.md` **只有派送句**（不再有知識副本）；使用者也可在開場直接引用 `/antigravity-plugins-maintenance` |

> **何時不必用本技能**：只問「graphify 怎麼安裝／怎麼建圖」→ `graphify-knowledge-graph`；只問「外掛有沒有裝起來、環境對不對」→ `health-check`；處理的是**別的 repo** 的圖譜 → 該 repo 自己的 `AGENTS.md`／技能。本技能**不適用**於跨 repo 的通用圖譜問題。

---

## 2. 這個 repo 是什麼

單一 git repo，內含 **6 個獨立 VS Code 擴充套件** ＋ 根目錄安裝腳本（`install-all.ps1`／`uninstall-all.ps1` 及 `.bat` 包裝）。

- 外掛之間**沒有程式碼共用**：實測 2,903 條邊只有 **1 條**「跨外掛」（且是 `node:sqlite` builtin 的誤判）。真正的耦合是 **VS Code command id 字串**，見 §7。
- 每個外掛各自帶一份 `install-extension.ps1`／`uninstall-extension.ps1`（6 份變體，**非共用模組**）⇒ 改安裝邏輯要同步 6 份。

---

## 3. 圖譜狀態（2026-10-26 實測，graphify 0.9.80）

| 項目 | 值 |
| :--- | :--- |
| 圖譜位置 | `graphify-out/`（根 `.gitignore` 已排除，**勿 commit**） |
| 規模 | **1595** nodes / **2903** edges / **91** communities |
| 建圖 commit | `ea192ae6`（2026-10-26 `graphify update .` 後重算，節點／邊／社群不變） |
| 掃描範圍 | 純程式：66 `.js` ＋ 15 `.ps1` ＋ 18 `.json`（= 99 檔，含 6 個 `package.json`）；`extract` 3 秒、`cluster-only` 1 秒、**0 元** |
| 產物大小 | `GRAPH_REPORT.md` **15.2 KB / 15,540 字元**（可整讀）、`graph.json` **1.9 MB**（禁整讀）、`graph.html` 1.5 MB |
| 不進圖 | `*.css`、`*.html`、`locales/*.json`（實測 0 節點）、`*.md`（`.graphifyignore` 已排除） |

> ⚠️ 上表是**快照**。用前先驗：`graphify-out/GRAPH_REPORT.md` 的 `## Summary` 段有節點／邊／社群數與 `Built from commit`，兩者對不上就當「已過期」。本檔（`*.md`）不進圖，所以只改本技能**不需要**跑 `update`。

---

## 4. 讀取紀律

1. **先讀** `graphify-out/GRAPH_REPORT.md` 的 `## Summary` 段（整份 15.2 KB 全讀也划算）。
2. 要細節才用 CLI（本地、免 API key、零成本）：`god-nodes --top 10`／`explain "<節點>"`／`affected "<節點>" --depth 2`／`path "A" "B"`／`query "<問題>" --context call --budget 1500`。
3. **永不整檔讀** `graph.json`（1.9 MB）。
4. 社群名是 `Community N`（建圖用 `--no-label`，未付 LLM 費用）→ 導航靠 `god-nodes`，不要期待語意化社群名。
5. 要改動時才開原始碼，並用圖譜給的 `檔名:L行號` 直接跳。
6. 圖譜與程式碼不一致 ⇒ **以程式碼為準**，收尾依 §5 更新。

> 📌 **同名節點要加路徑**：`explain "McpConfigService"` 會回 `Ambiguous`（3 個節點：service 本體／`extension.js` 引用／測試）。改用 `graphify explain "antigravity-mcp-manager/services/mcpConfigService.js::McpConfigService"`（實測可用，Source 指到 `L35`）。

> 📌 **`$LASTEXITCODE` 不可靠**：實測 `explain`／`query`／`god-nodes` 成功也回 `-1`（只有 `extract`／`cluster-only`／`update` 回 `0`）。成敗請看輸出；`query` 出現 `TRUNCATED` 是預算不足，加大 `--budget` 或縮小問題，**不是壞掉**。

---

## 5. 改完自動更新（本節即授權）

- 改了**被抽取的檔案**（`.js`／`.ps1`／`package.json`）⇒ 收尾**直接執行** `graphify update .`，**不需要再詢問使用者**；完成後回報節點／邊／社群數變化與 `Built from commit` 是否＝HEAD。
- **只改** `.md`／`.css`／`locales/*.json` ⇒ **不要**跑 `update`（屬無害過期；`.graphifyignore` 已排除 `*.md`）。
- 邊界：不要加 `--no-cluster`（會寫出沒有 community 的 `graph.json` 而報告仍是舊分群）；節點變少被「縮圖保護」擋下才加 `--force`；`update` 會重建 `graph.html`（正常）。`graphify-out/` 不要 commit。

---

## 6. 這張圖的邊界

| 抓得到（附 `檔名:行號`） | 抓不到 |
| :--- | :--- |
| 類別／方法呼叫、`require`、繼承、`package.json` contributes | 跨外掛 **command id 字串**（§7 人工維護）、`workbench.view.extension.<container>` |
| PowerShell 函式（實測 `.ps1` 有節點） | `.css`／`.html`／DOM id、`locales/*.json` 的 i18n key |
| 檔案 → 符號 → 社群歸屬 | runtime 動態呼叫、`env` 等設定資料 |

> ⚠️ **同名 helper 大量重複**：`get-runningideforroot()`、`test-isownextensionartifact()` 各 **14 份**（6 外掛 ＋ 2 支根腳本）。`explain` 會回多筆同 label → 用 `source_file` 辨識；改安裝邏輯時**必須同步 6 份**。

> ℹ️ 實測有 **6 個 code 檔「掃到但零符號」**（`media/*/locales.js` 的 i18n 資料表 ×4、`quota-refresh-trigger.ps1` 等）：`update` 每次都會印 stderr warning，**屬正常**（`$LASTEXITCODE` = 0）。

---

## 7. 跨外掛耦合（圖譜盲區；2026-10-24 實測 grep）

| 呼叫方 | 被呼叫的 command id | 依賴外掛 |
| :--- | :--- | :--- |
| `antigravity-quick-access/extension.js` | `scriptRunner.runBat`、`scriptRunner.runBatAdmin`、`scriptRunner.runPs1`、`scriptRunner.runPs1Admin`、`scriptRunner.runPy`、`scriptRunner.viewFolderImages`、`scriptRunner.viewFolderAudios`、`scriptRunner.viewFolderVideos`（8 個） | `antigravity-script-runner` |
| `antigravity-quick-access/extension.js` | `antigravity.toolbox.addScriptToRunner` | `antigravity-toolbox` |

- 這些全是 `executeCommand('<id>')` **字串呼叫**，AST 產生不了邊 → **改 id 或移除外掛前必須 grep** `scriptRunner.` 與 `antigravity.toolbox.`。
- `antigravity.aiContextView.focus`、`antigravity.mcpManagerView.focus`、`antigravity.toolboxView.focus`、`workbench.view.extension.antigravity-toolbox-container` 都是**各外掛自我引用**，不算跨外掛依賴（易誤判，已逐一查證）。

---

## 8. 六外掛速查（節點數＝該外掛目錄貢獻的節點數）

| 外掛 | 版本 | 節點 | 對外 id 家族 | view／container | 進入點／服務 |
| :--- | :--- | ---: | :--- | :--- | :--- |
| `antigravity-script-runner` | 1.7.1 | 459 | `scriptRunner.*`（8 個 id × `.en`／`.cn`＝24） | 無 view（右鍵選單＋媒體檢視） | `extension.js`／6 services（audio／video／image／stream） |
| `antigravity-ai-context-inspector` | 1.2.1 | 332 | `antigravity.aiContext.*`（3 ＋ `.en`） | `antigravity.aiContextView`／`antigravity-ai-context-container` | `extension.js`／6 services（cline·cursor·vscode chat／contextScanner／mcpDetector） |
| `antigravity-mcp-manager` | 1.9.2 | 271 | `antigravity.mcp.*`（6 ＋ `.en`） | `antigravity.mcpManagerView`／`mcp-manager-container` | `extension.js`／9 services |
| `antigravity-toolbox` | 1.4.0 | 248 | `antigravity.toolbox.*`（7 ＋ 4 `.en`） | `antigravity.toolboxView`／`antigravity-toolbox-container` | `extension.js`／6 services（brain／copilotChat／skillSync／workspace…） |
| `antigravity-quota-status` | 1.1.0 | 178 | `aiQuota.*`（7，無變體） | 無 view（狀態列） | `extension.js`／4 services（quota／cursorAuth…） |
| `antigravity-quick-access` | 1.2.6 | 83 | `antigravity.quickAccess.*`（20 × 3＝60） | `antigravity.quickAccessView` | `extension.js`／無 `services/` 目錄 |

> 六個外掛都是 `main: ./extension.js`、CommonJS；`engines.vscode` 除 quota-status（`^1.68.0`）外皆 `^1.80.0`。webview 前端在 `media/`（inspector／mcp-manager／quick-access／script-runner／toolbox），**不進圖**。
> 版本與節點數會過期：版本看各外掛 `package.json` 的 `version`，節點數看 `graphify god-nodes` 或 `GRAPH_REPORT.md`。

---

## 9. 首次建圖／重建（`graphify-out/` 不存在時）

```powershell
graphify --version                 # 需 0.9.x（本圖以 0.9.80 建立）
graphify extract . --code-only     # 純 AST，0 元
graphify cluster-only . --no-label # 產生 GRAPH_REPORT.md；--no-label 不呼叫 LLM
```

> ⛔ 沒有 `graphify-out/` 時**不可**直接 `graphify update .` —— 會生出只含變更檔的部分圖譜且報告無警示。
> 📌 本 repo 已在根目錄放 `.graphifyignore`（`*.md`）：`update` 沒有 `--code-only`，靠它維持「純程式架構圖」，避免 AGENTS.md／本技能／README 變成 `document` 節點。

---

## 10. 反模式（踩過的坑）

| 反模式 | 後果 | 正確做法 |
| :--- | :--- | :--- |
| 沒確認 `graphify-out/` 就 `graphify update .` | 生出只含變更檔的**部分圖譜**，報告還不警示 | 依 §9 先 `extract --code-only` ＋ `cluster-only` |
| `explain "McpConfigService"` 不帶路徑 | 回 `Ambiguous`，被誤讀成「找不到」 | 用 `檔案::符號` 形式（§4 第一個 📌） |
| 改完只跑一份 `install-extension.ps1` 就說「修好了」 | 只有 1／6 外掛生效（六份同名 helper 不會互相 import） | 同步 6 份並 grep 確認 |
| 靠 `$LASTEXITCODE` 判斷 `explain`／`query` 成敗 | 成功也回 `-1`，會被誤判為失敗 | 看輸出內容（§4 第二個 📌） |
| 把 `graphify-out/` commit 進版控 | 1.9 MB 產物、每次 `update` 都變動 | 保持 `.gitignore` 的排除 |

> 這幾條都是**實際失敗過**才寫上來的（2026-10-24～26 的踩坑記錄），不是假設性風險。

> 未結案的專案問題放 `references/`：VSCodium 支援的文件／實作落差 → [`references/vscodium-support-gap.md`](references/vscodium-support-gap.md)。

---

## 11. 本技能維護

- 本技能＝這個 repo 的**唯一真相**：常數、授權、耦合表、邊界、反模式全在這裡；根 `AGENTS.md` 只剩「叫用本技能」的派送句（約 470 字元），**不承載知識** → 要改規則只改本檔，不要改根檔。
- 使用者可能在開場直接引用本技能（`/antigravity-plugins-maintenance`）。**取捨**：若沒被叫用，§5 的授權與 §6／§7 的鐵律都不在 context —— 這是刻意換掉「同一內容寫兩遍」的代價。
- 通用圖譜流程不重複抄寫（指向 `graphify-knowledge-graph`）；本檔只管**這個 repo** 的常數與授權。
- §3 與 §8 的數字會過期：**更新圖譜後順手更新並改日期**；無法確認就寫「查法」而不是寫死。
- 本檔刻意不含絕對磁碟路徑，repo 搬移或複製到別台機器後仍有效。

### 變更記錄

| 日期 | 變更 | 來源 |
| :--- | :--- | :--- |
| 2026-10-26 | 由 repo 根 `AGENTS.md` 全文改寫成技能（內容等價，另修正 §3 舊值 13.6 KB → 15.2 KB）；根 `AGENTS.md` 瘦身為進場指引 | 使用者指示 |
| 2026-10-26 | description 283 → 241 字元（過 260 硬線）；補 §1 負向邊界／何時不必、§10 反模式；新增 `references/vscodium-support-gap.md` | `skill-score-audit.ps1` 14/20 的缺口清單 |
| 2026-10-26 | 知識 100% 收斂到本檔：刪掉根 `AGENTS.md` 的鐵律副本（1,186 → 約 470 字元，只剩派送句） | 使用者指示（同一內容不要寫兩遍） |

