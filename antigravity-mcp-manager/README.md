# MCP 管理儀表板

Antigravity 提供完整儀表板（清單、連線探測、備註與原生開關），並常駐左側活動列。Cursor 與 VS Code 只在底部狀態列顯示 `MCP: 啟用數/總數`，不開啟左側活動列，也不在編輯器分頁打開儀表板。

三種宿主只在**目前這個 IDE 已安裝且啟用 Cline** 時，狀態列才會並列 Cline 的 MCP 統計（`… · Cline 啟用數/總數`），懸停視窗另列兩端伺服器清單。沒安裝、或曾經安裝但已停用時，狀態列只顯示本 IDE 的 MCP，不出現 Cline。殘留的 `cline_mcp_settings.json` 不會被當成已安裝。Cline 一律為**純檢視**：本套件在服務層就沒有寫入 Cline 設定的能力，開關請用 Cline 自身的 MCP 面板。

---

## 核心特色

1. **Antigravity 原生開關**：讀寫 `~/.gemini/config/mcp_config.json`（`mcpServers`，以 `disabled` 欄位開關）。
2. **VS Code 檢視模式**：讀取 `<User>/mcp.json`、工作區 `.vscode/mcp.json` 與工作區根 `.mcp.json`，並從 `state.vscdb` 的 `mcp.enablement` 顯示真實啟停狀態（含工作區覆寫）。開關請用 **VS Code 原生 UI**。面板另併入 Copilot CLI 的 `~/.copilot/mcp-config.json`（唯讀、以徽章區分來源，詳見「Copilot CLI 整合」）。
3. **Cursor 檢視模式**：讀取 `~/.cursor/mcp.json`，並從 Cursor 的 Customize 停用清單顯示側邊高光與啟用數。開關仍請用 **Customize**。
4. **外部 Sidecar 註解分離**：Antigravity 用 `~/.gemini/config/antigravity_mcp_notes.json`；Cursor 用 `~/.cursor/mcp_notes.json`；VS Code 用 `<User>/mcp_notes.json`。
5. **Antigravity 左側活動列**：可在此面板直接開關 MCP。
6. **狀態列即時指示**：三種環境都顯示 `MCP: 啟用數/總數`；目前 IDE 已啟用 Cline 時才並列 `· Cline 啟用數/總數`（未安裝或已停用則不顯示），可用「切換狀態列顯示方式」決定只顯示本 IDE、只顯示 Cline 或兩者。Cursor 與 VS Code 只有這條狀態列，不開啟左側活動列，也不在編輯器分頁打開儀表板。
7. **Cline 純檢視（API 層保證）**：狀態列快捷選單提供「檢視 Cline MCP 伺服器狀態」，可看工具清單、啟停情形與開啟 `cline_mcp_settings.json`。Cline 服務只有讀取與統計能力，**不含任何寫入 API**，因此不論宿主、顯示範圍或批次操作都不會改動 Cline 的設定檔。
8. **兩向熱重載**：修改 MCP 設定檔（含 Cline 的 `cline_mcp_settings.json`），或在 **VS Code 原生 UI** 切換開關時，狀態列會自動更新。Antigravity 已開啟的儀表板也會一起更新。

---

## 安裝與啟用

1. 雙擊 [`install-extension.bat`](./install-extension.bat)（或執行 [`install-extension.ps1`](./install-extension.ps1)）。
   - 可安裝至 **Antigravity IDE**、**Cursor** 與 **Visual Studio Code**。
2. 在目標 IDE 按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，執行 `Developer: Reload Window`。
3. Antigravity 左側活動列出現 **「MCP 伺服器管理」**；Cursor 與 VS Code 只在右下狀態列顯示 **MCP 啟用數**（目前 IDE 已啟用 Cline 時才並列 Cline 統計與「檢視 Cline MCP」捷徑）。

---

## Cline 整合（三種宿主共用，純檢視）

只有目前這個 IDE 的延伸模組宿主看得到已啟用的 Cline（`saoudrizwan.claude-dev`）時，狀態列、懸停視窗與快捷選單才會呈現 Cline 的 MCP 資訊。未安裝或已停用時這些位置都不出現 Cline：

| 位置 | 內容 |
| --- | --- |
| 狀態列 | `MCP: <本 IDE> 啟用數/總數 · Cline 啟用數/總數`（顯示範圍可用「切換狀態列顯示方式」調整，只影響顯示） |
| 懸停視窗 | 分兩段列出本 IDE 與 Cline 的已啟用伺服器名稱，並標示目前顯示範圍 |
| 快捷選單 | 「檢視 Cline MCP 伺服器狀態」（清單、啟停、開啟設定檔）與「開啟 Cline MCP 設定檔」 |

- 設定檔採自推導：優先 `~/.cline/data/settings/cline_mcp_settings.json`，其次 `~/.cline/settings/`，再退回各 IDE 的 `globalStorage/saoudrizwan.claude-dev/settings/`。
- **Cline 一律唯讀（含 Antigravity 批次操作）**：本套件只讀取統計與清單，不寫入 `cline_mcp_settings.json`；批次開關也只作用於本 IDE，顯示範圍設為「兩者」時同樣不會連動 Cline。Cline 的開關請用 Cline 自身的 MCP 面板。
- `cline_mcp_settings.json` 有檔案監聽，Cline 端新增／開關伺服器後狀態列會即時跟上。

---

## Copilot CLI 整合（VS Code 宿主，純檢視）

VS Code 的 MCP 伺服器與 Copilot CLI（Agent Host）的 MCP 伺服器是**兩份不同的檔案**：VS Code 讀 `<User>/mcp.json`，Copilot CLI 讀 `~/.copilot/mcp-config.json`。面板會把兩者**並列在同一份清單**，並以 `Copilot CLI` 徽章區分來源，避免只看到其中一份而誤以為伺服器消失了。

| 位置 | 內容 |
| --- | --- |
| 狀態列 | **以主要來源為準**：Copilot CLI 設定檔內有伺服器時顯示 `MCP: Copilot 啟用數/總數`，否則維持 `MCP: VS Code 啟用數/總數` |
| 儀表板清單 | VS Code 來源與 Copilot CLI 來源並列；篩選標籤的數字由列出的卡片推導，涵蓋兩者 |
| 懸停視窗 | 第一段為主要來源、第二段為另一個來源（僅在確有內容或設定檔損毀時出現） |
| 快捷選單 | 「開啟 Copilot CLI MCP 設定檔」 |

- **主要來源的判定**（先看「有沒有東西可用」，避免狀態列顯示 0 卻藏著實際可用的來源）：
  1. Copilot CLI 有**啟用中**的伺服器 → Copilot CLI
  2. 否則本 IDE（VS Code）自己有啟用中的伺服器 → VS Code
  3. 兩邊都沒有啟用中的伺服器時，只要 CLI 有設定檔就仍以 CLI 為主（`0/6` 比 `0/0` 有資訊量：讓你知道伺服器是被停用而非不存在）
- 兩份設定檔都有伺服器時，另一個來源會以第二段列出，資訊不會被隱藏。
- **開關只能由 VS Code 的 UI 切換**：實測 `agent-host-storage.json` 由 VS Code 自身持有，直接改檔會在數分鐘內被它覆寫回原值（2026-10-08 實證：寫入後 3 分鐘被還原）。要啟停請用 MCP 伺服器清單的開關；面板會在約 1.5 秒內跟上。
- **開關狀態來自 agent host（不是 CLI 檔案）**：VS Code 的 MCP 開關寫在
  `<User>/globalStorage/agent-host-storage.json` 的 `customizationEnablement.global["mcpServers#<名稱>"]`
  （`false` = 已停用）；Copilot CLI 設定檔本身沒有停用欄位。面板會讀這份狀態，因此你在 VS Code 的 MCP 清單切換開關後，約 1.5 秒內就會反映（同一輪輪詢也涵蓋 `state.vscdb`）。
  - 工作區層覆寫（`workingDirectories[<工作區 URI>]`）優先於全域，與 agent host 的解析順序一致。
  - 停用時卡片會標記 `disabledBy: agentHost`，與「設定檔自身宣告停用」區分。
- 路徑推導：`COPILOT_HOME` 環境變數優先，否則 `~/.copilot/mcp-config.json`（與 VS Code 內建 MCP 遷移器的解析一致）。
- 鍵名為 `mcpServers`（**不是** VS Code 的 `servers`）；型別為 `stdio` / `http`，舊檔案的 `local` 視同 `stdio`。
- **同名衝突**：同名時以 VS Code 來源優先，CLI 條目改用內部鍵 `copilot-cli:<名稱>`，畫面仍顯示原始名稱；備註（`mcp_notes.json`）兩種鍵都對得上。
- **Copilot CLI 沒有停用狀態**（不像 VS Code 有 `state.vscdb` 的 `mcp.enablement`），故 CLI 條目一律計為啟用、不提供開關；只有設定檔自行宣告 `disabled` 時才會顯示為停用。
- 設定檔存在但無法解析時，懸停視窗會標示「設定檔無法解析」，而不是靜默顯示 0 個伺服器。
- 此來源只在 VS Code 宿主顯示；Antigravity 與 Cursor 的面板維持原樣（主要來源仍為各自的 `mcp_config.json` / `mcp.json`）。
- `~/.copilot/mcp-config.json` 有檔案監聽，內容變更時會即時更新。

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
| Copilot CLI 設定檔 | `~/.copilot/mcp-config.json`（`COPILOT_HOME` 可覆寫；鍵名為 `mcpServers`，唯讀並列顯示） |
| 全域啟停 | `<User>/globalStorage/state.vscdb` → 鍵 `mcp.enablement`（id `mcp.config.usrlocal.<名稱>`） |
| 工作區啟停 | `workspaceStorage/<hash>/state.vscdb` → 鍵 `mcp.enablement` |
| Agent Host 啟停 | `<User>/globalStorage/agent-host-storage.json` → `customizationEnablement.global["mcpServers#<名稱>"]`（VS Code 的 MCP 伺服器清單開關；Copilot CLI 來源以此為準） |

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

實作採「變更簽章輪詢」：每輪僅對狀態檔做 `stat` 比對，**唯有真的變動才重新解析**（`state.vscdb` 與 `agent-host-storage.json` 都納入簽章），因此不會造成無謂耗用。

> ⚠️ **切勿直接改寫 `agent-host-storage.json`**：該檔由 VS Code 自身持有，程式化寫入會在數分鐘內被覆寫回原值（2026-10-08 實證）。切換開關請走 VS Code 的 UI，本套件對它一律唯讀。

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

## 回歸測試

零相依、直接以 Node 執行；所有夾具都建在系統暫存目錄並於結束時自動清除，**不會碰到真實設定檔**。

```powershell
node tests/agent-host-enablement.test.js
```

- 離開碼 `0` = 全數通過、`1` = 有失敗（可直接接 CI 或 hook）。
- 涵蓋 20 項斷言：enablement 鍵的命名空間（`mcpServers#<名稱>` 與 `<pluginSource>#mcp=<名稱>` 的區分，避免跨來源誤停用）、停用狀態以 agent host 為準、主要來源判定順序、工作區覆寫、設定檔自身宣告、VS Code 與 CLI 兩來源並列的同名衝突、以及簽章是否涵蓋開關檔（輪詢即時性）。
- 負對照已驗證：把「plugin 前綴過濾」或「主要來源規則」還原成舊寫法時，對應斷言會失敗。

---

## 移除與卸載

1. 雙擊 [`uninstall-extension.bat`](./uninstall-extension.bat)（或執行 [`uninstall-extension.ps1`](./uninstall-extension.ps1)）。
2. 在 IDE 執行 `Developer: Reload Window`。
