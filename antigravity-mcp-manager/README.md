# MCP 管理儀表板

Antigravity 提供完整儀表板（清單、連線探測、備註與原生開關），並常駐左側活動列。Cursor 與 VS Code 只在底部狀態列顯示 `MCP: 啟用數/總數`，不開啟左側活動列，也不在編輯器分頁打開儀表板。

三種宿主只要偵測到本機已安裝 **Cline**，狀態列就會同時並列 Cline 的 MCP 統計（`… · Cline 啟用數/總數`），懸停視窗另列兩端伺服器清單。Cline 一律為**純檢視**：本套件在服務層就沒有寫入 Cline 設定的能力，開關請用 Cline 自身的 MCP 面板。

---

## 核心特色

1. **Antigravity 原生開關**：讀寫 `~/.gemini/config/mcp_config.json`（`mcpServers`，以 `disabled` 欄位開關）。
2. **VS Code 檢視模式**：讀取 `<User>/mcp.json`、工作區 `.vscode/mcp.json` 與工作區根 `.mcp.json`，並從 `state.vscdb` 的 `mcp.enablement` 顯示真實啟停狀態（含工作區覆寫）。開關請用 **VS Code 原生 UI**。
3. **Cursor 檢視模式**：讀取 `~/.cursor/mcp.json`，並從 Cursor 的 Customize 停用清單顯示側邊高光與啟用數。開關仍請用 **Customize**。
4. **外部 Sidecar 註解分離**：Antigravity 用 `~/.gemini/config/antigravity_mcp_notes.json`；Cursor 用 `~/.cursor/mcp_notes.json`；VS Code 用 `<User>/mcp_notes.json`。
5. **Antigravity 左側活動列**：可在此面板直接開關 MCP。
6. **狀態列即時指示**：三種環境都顯示 `MCP: 啟用數/總數`；偵測到 Cline 時並列 `· Cline 啟用數/總數`，可用「切換狀態列顯示方式」決定只顯示本 IDE、只顯示 Cline 或兩者。Cursor 與 VS Code 只有這條狀態列，不開啟左側活動列，也不在編輯器分頁打開儀表板。
7. **Cline 純檢視（API 層保證）**：狀態列快捷選單提供「檢視 Cline MCP 伺服器狀態」，可看工具清單、啟停情形與開啟 `cline_mcp_settings.json`。Cline 服務只有讀取與統計能力，**不含任何寫入 API**，因此不論宿主、顯示範圍或批次操作都不會改動 Cline 的設定檔。
8. **兩向熱重載**：修改 MCP 設定檔（含 Cline 的 `cline_mcp_settings.json`），或在 **VS Code 原生 UI** 切換開關時，狀態列會自動更新。Antigravity 已開啟的儀表板也會一起更新。

---

## 安裝與啟用

1. 雙擊 [`install-extension.bat`](./install-extension.bat)（或執行 [`install-extension.ps1`](./install-extension.ps1)）。
   - 可安裝至 **Antigravity IDE**、**Cursor** 與 **Visual Studio Code**。
2. 在目標 IDE 按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，執行 `Developer: Reload Window`。
3. Antigravity 左側活動列出現 **「MCP 伺服器管理」**；Cursor 與 VS Code 只在右下狀態列顯示 **MCP 啟用數**（已安裝 Cline 時並列 Cline 統計與「檢視 Cline MCP」捷徑）。

---

## Cline 整合（三種宿主共用，純檢視）

只要本機偵測到 Cline 延伸模組（`saoudrizwan.claude-dev`）或其設定檔，狀態列、懸停視窗與快捷選單就會一併呈現 Cline 的 MCP 資訊：

| 位置 | 內容 |
| --- | --- |
| 狀態列 | `MCP: <本 IDE> 啟用數/總數 · Cline 啟用數/總數`（顯示範圍可用「切換狀態列顯示方式」調整，只影響顯示） |
| 懸停視窗 | 分兩段列出本 IDE 與 Cline 的已啟用伺服器名稱，並標示目前顯示範圍 |
| 快捷選單 | 「檢視 Cline MCP 伺服器狀態」（清單、啟停、開啟設定檔）與「開啟 Cline MCP 設定檔」 |

- 設定檔採自推導：優先 `~/.cline/data/settings/cline_mcp_settings.json`，其次 `~/.cline/settings/`，再退回各 IDE 的 `globalStorage/saoudrizwan.claude-dev/settings/`。
- **Cline 一律唯讀（含 Antigravity 批次操作）**：本套件只讀取統計與清單，不寫入 `cline_mcp_settings.json`；批次開關也只作用於本 IDE，顯示範圍設為「兩者」時同樣不會連動 Cline。Cline 的開關請用 Cline 自身的 MCP 面板。
- `cline_mcp_settings.json` 有檔案監聽，Cline 端新增／開關伺服器後狀態列會即時跟上。

---

## 狀態列顯示範圍（單一設定來源）

| 設定 | 可選值 | 說明 |
| --- | --- | --- |
| `antigravity.mcp.displayMode` | `both`（預設）／`antigravity`／`cline` | 狀態列顯示本 IDE、Cline 或兩者 |

- 快捷選單的「切換狀態列顯示方式」與 **VS Code 設定 UI** 都寫入這一個設定；懸停視窗的「目前顯示範圍」讀同一來源，兩處不會各說各話。
- 值 `antigravity` 代表「目前這個 IDE 自己的 MCP」（在 VS Code / Cursor 亦沿用同一鍵名）。
- **顯示範圍只影響顯示，不影響寫入範圍**：批次操作永遠只作用於本 IDE。
- 由舊版升級時，若曾以快捷選單設定過顯示範圍（存於 extension globalState），會於啟動時自動遷移進此設定並清除舊值。

---

## VS Code 開關機制說明

VS Code Copilot 的 MCP 啟停狀態**不在** `mcp.json`，而是存放於 VS Code 內部狀態資料庫（官方文件：「The enable/disable state is stored separately from the server configuration in `mcp.json`」）。

| 項目 | 路徑 |
| --- | --- |
| 使用者設定檔 | `<User>/mcp.json`（鍵名為 `servers`，另含 `inputs`） |
| 工作區設定檔 | `<工作區>/.vscode/mcp.json`（鍵名為 `servers`） |
| 工作區根設定檔 | `<工作區>/.mcp.json`（鍵名為 `mcpServers`，或裸格式；不支援 `inputs`） |
| 全域啟停 | `<User>/globalStorage/state.vscdb` → 鍵 `mcp.enablement` |
| 工作區啟停 | `workspaceStorage/<hash>/state.vscdb` → 鍵 `mcp.enablement` |

- 值格式：`[["mcp.config.usrlocal.<名稱>", true|false], …]`。`false` = 停用、`true` = 明確啟用、**不存在 = 預設啟用**。
- 工作區覆寫優先於全域；面板以卡片上方的徽章顯示「僅此工作區啟用」／「此工作區停用」。
- 面板**不寫入**這座資料庫（詳見下方「為何不提供寫入」）。

### 主開關的語意

卡片上的主開關反映的是**實際生效狀態**（與 VS Code 一致）：你看見的就是「這個工作區現在能不能用」。開關滑鼠提示會說明目前是哪一層在決定：

- 「此伺服器在此工作區已停用（全域仍為啟用）」→ 工作區覆寫 = 停用
- 「此伺服器僅在此工作區啟用（全域為停用）」→ 工作區覆寫 = 啟用
- 「此伺服器已全域停用」→ 全域層停用

### 與 VS Code 原生 UI 的即時連動

當你在 VS Code 原生 UI（Copilot 設定、擴充檢視的 MCP SERVERS、`MCP: List Servers`）切換開關時，底部狀態列會在約 1.5 秒內反映（視窗重新聚焦時立即校正）。Cursor 與 VS Code 不開啟本套件的儀表板分頁或左側活動列。

實作採「變更簽章輪詢」：每輪僅對狀態檔做 `stat` 比對，**唯有真的變動才重新解析 SQLite**，因此不會造成無謂耗用。

### 如何切換 MCP 開關（VS Code）

| 方式 | 操作 |
| --- | --- |
| 擴充檢視 | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> → `@mcp` → 於 **MCP SERVERS - INSTALLED** 右鍵選 Enable / Disable |
| 命令選擇區 | `MCP: List Servers` → 選伺服器 → Enable / Disable |
| Copilot 設定 | 於 Copilot 的 MCP 設定中個別開關 |

啟停狀態是**可重載的**，切換後 VS Code 自身會立即生效，底部狀態列也會自動跟上。

### 為何不提供寫入

本擴充套件曾在 1.7.0 提供「進階寫入模式」直接改寫 `mcp.enablement`，但該作法的兩項缺點無法消除，故於 1.8.0 移除，改為與 Cursor 一致的純檢視：

1. **必須重載視窗才生效**：`mcp.enablement` 於視窗載入時即讀入記憶體，寫入後需 `Developer: Reload Window`；且重載前若於 VS Code 內再切換開關，會被整份舊資料覆寫。
2. **屬未公開的內部機制**：格式若於日後版本變動，將無聲失效。

改為檢視模式後，開關一律由 VS Code 原生 UI 負責。Cursor 與 VS Code 只以底部狀態列顯示啟用數（含 Cline 統計），不提供儀表板介面；Cline 的啟停同樣不在本套件的寫入範圍（詳見上方「Cline 整合」）。

---

## 移除與卸載

1. 雙擊 [`uninstall-extension.bat`](./uninstall-extension.bat)（或執行 [`uninstall-extension.ps1`](./uninstall-extension.ps1)）。
2. 在 IDE 執行 `Developer: Reload Window`。
