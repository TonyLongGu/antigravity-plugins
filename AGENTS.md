# AGENTS.md — antigravity-plugins

> 一句話：**這個 repo 的知識在圖譜裡。動工前先讀（§1）、改完更新（§2）**；細節見 §4 指標。
> 衝突優先序：安全／授權 ＞ 正確性 ＞ 精簡；harness 全域規範優先。路徑一律相對。
> ⚠️ Cline 只讀**第一個根目錄**的 `AGENTS.md`（2026-10-26 實測）⇒ 在本 repo 工作請**單獨開啟這個資料夾**。

## 這個專案是什麼

- 單一 repo 內含 **6 個獨立 VS Code 擴充套件**（script-runner／ai-context-inspector／mcp-manager／toolbox／quota-status／quick-access）＋ 根目錄 `install-all.ps1`／`uninstall-all.ps1`。
- 外掛之間**沒有程式碼共用**；真正的耦合是跨外掛的 **command id 字串**（改 id 前先 grep `scriptRunner.`／`antigravity.toolbox.`）。
- **安裝／卸載邏輯只在根目錄 2 支腳本**；各外掛內的 `install-extension.ps1`／`uninstall-extension.ps1` 是薄殼（只轉 `-Plugin`），`.bat` 不動。
- 一鍵全裝：`-Target` 預設 `All`、`-Plugin` 省略＝全部；`quota-status` 不進 VS Code；**VSCodium 只偵測、不部署**。
- 測試：各外掛 `tests/*.test.js`，直接 `node <檔案>`（零相依、無框架）。

## 1. 動工前：先讀圖譜

- 讀 `graphify-out/GRAPH_REPORT.md` 的 `## Summary`（整份約 17 KB，全讀也划算）。
- 要細節才用 CLI（本地、0 元）：`god-nodes --top 10`／`explain "<檔案>::<符號>"`／`affected "<節點>" --depth 2`／`query "…" --context call --budget 1500`。
- ⛔ 永不整檔讀 `graph.json`（約 2 MB）；同名節點要加路徑（如 `.../services/mcpConfigService.js::McpConfigService`）。
- ⛔ `$LASTEXITCODE` 不可靠：`explain`／`query`／`god-nodes` 成功也回 `-1`，成敗**看輸出**。
- 圖譜與程式碼不一致 ⇒ **以程式碼為準**。
- 沒有 `graphify-out/` ⇒ 先建圖（`extract . --code-only` → `cluster-only . --no-label`），**不可**直接 `update`。

## 2. 動工後：更新圖譜（本節即授權）

- 改了 `.js`／`.ps1`／`.json`（被抽取的檔）⇒ 收尾**直接跑** `graphify update .`，不必再問；回報「節點／邊／社群變化」＋`Built from commit` 是否＝HEAD。
- 只改 `.md`／`.css`／`locales/*.json` ⇒ 不跑。`update` 會印「18 檔零符號」警告，屬正常、`$LASTEXITCODE` 仍 `0`。
- ⛔ 不加 `--no-cluster`；`graphify-out/` **不 commit**（已列 `.gitignore`）。

## 3. 最貴的紅線（其餘看 §4）

- 改安裝／卸載只改**根** 2 支腳本，改薄殼等於沒改。
- 新增／移除外掛要同步 4 處：`$candidatePool`、`$environmentExclusions`、`-Plugin` 對照、`README.md` 支援表。
- 動到 UI／安裝流程，跑對應的 `tests/*.test.js` 再收工。

## 4. 細節去哪找

| 要什麼 | 去哪 |
| :--- | :--- |
| 圖譜通用流程（安裝、旗標、驗證、成本） | skill `graphify-knowledge-graph` |
| 本專案細節備忘（六外掛速查、flavor 切換、耦合表、圖譜邊界、反模式、快照數字） | [`docs/project-notes.md`](docs/project-notes.md) |
| 安裝／功能說明（使用者向） | [`README.md`](README.md) |
