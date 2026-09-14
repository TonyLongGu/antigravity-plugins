# Antigravity MCP 管理儀表板 - 跨 IDE 原生側邊欄擴充套件

專為 **Google Antigravity IDE** 與 **Visual Studio Code** 雙環境打造的原生側邊欄擴充套件（VS Code Extension），提供全域 MCP 伺服器開關控制、狀態監控、即時連線測試、獨立 sidecar 備註註解與設定檔快速編輯功能。

本擴充套件遵循 [`ide-extension-workflow`](file:///d:/PJ/Ai/ai/.agents/skills/ide-extension-workflow/SKILL.md) 規範，採用後端 Services 職責分離架構、極致緊湊 4 層 Spacing Tokens 與前端 `vscode.getState()` 狀態持久化機制。

---

## 🌟 核心特色

1. **雙 IDE 智慧相容 (Dual-IDE Compatible)**：
   - 自動偵測執行環境（`vscode.env.appName`）：
     - **Google Antigravity IDE**：讀寫 `~/.gemini/config/mcp_config.json`（屬性為 `mcpServers`）。
     - **Visual Studio Code**：讀寫 `~/AppData/Roaming/Code/User/mcp.json`（屬性為 `servers`，並支援命令、參數與網址型伺服器）。
2. **外部 Sidecar 註解分離架構 (No Schema Warnings)**：
   - 解決 VS Code 原生 `mcp.json` 嚴格 Schema 驗證（`additionalProperties: false`，不支援自訂 `description` 屬性）之限制。
   - 雙 IDE 採用獨立註解檔，互不衝突且不干擾原生 IDE Schema：
     - Google Antigravity IDE：持久化於 [`antigravity_mcp_notes.json`](./antigravity_mcp_notes.json)
     - Visual Studio Code：持久化於 [`vscode_mcp_notes.json`](./vscode_mcp_notes.json)
3. **無縫嵌入 IDE 側邊欄**：常駐在 IDE 左側活動列（Activity Bar），點擊專屬圖示即可直接操作，無需切換外部瀏覽器。
4. **模組化服務架構 (Modular Services)**：
   - `McpConfigService`：安全讀寫、雙環境自動備份（`.bak`）、格式正規化、獨立 sidecar 註解合併與單項/批次切換。
   - `ProbeService`：CLI 進程探針（支援 JSON-RPC ping 與 Windows `taskkill` 進程樹回收）與遠端 HTTP/SSE 延遲測速（支援 `serverUrl` 與 `url`）。
   - `SystemService`：編輯器設定檔開啟與系統整合。
5. **狀態持久化 (State Persistence)**：透過 `vscode.getState()` / `vscode.setState()` 保存搜尋關鍵字與篩選條件，側邊欄切換不丟失上下文。
6. **即時連線測速與一鍵全測**：
   - 支援個別伺服器連線測試（顯示延遲 ms 與狀態圓點）。
   - 頂部提供「一鍵測速」按鈕，快速排程測試所有伺服器連線健全度。
7. **狀態列即時指示 (Status Bar)**：底部狀態列常駐顯示 `⚡ MCP: X/Y [Antigravity IDE]` 或 `⚡ MCP: X/Y [VS Code]`，即時反應當前啟用的 MCP 數量與執行環境。
8. **熱重載與檔案監聽 (File Watcher)**：外部或 AI 修改 MCP 設定檔時，側邊欄與狀態列自動即時更新。

---

## 🚀 安裝與啟用教學

### 一鍵安裝（免編譯 Junction 零複製掛載）
1. 雙擊執行目錄下的 [`install-extension.bat`](./install-extension.bat)（或以 PowerShell 執行 [`install-extension.ps1`](./install-extension.ps1)）。
   - 腳本將自動偵測本機已安裝的 **VS Code** 與 **Antigravity IDE**，並同步掛載 Junction 與註冊 `extensions.json`。
2. 在 Antigravity IDE 或 VS Code 中按下快捷鍵 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，輸入並選擇：
   ```text
   Developer: Reload Window
   ```
3. 重新載入後，即可在左側活動列看見 **「MCP 伺服器管理」** 專屬圖示！

---

## 🗑️ 移除與卸載教學

### 一鍵移除
1. 雙擊執行目錄下的 [`uninstall-extension.bat`](./uninstall-extension.bat)（或以 PowerShell 執行 [`uninstall-extension.ps1`](./uninstall-extension.ps1)）。
2. 在 IDE 中按下快捷鍵 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，執行 `Developer: Reload Window` 即可完全卸載。

---

## 📁 目錄結構

```text
antigravity-mcp-manager/
├── package.json               # 擴充套件清單、活動列容器與選單指令註冊 (v1.2.0)
├── extension.js               # Extension Host 進入點、雙環境偵測、狀態列與訊息路由
├── services/                  # 後端業務服務層 (職責分離)
│   ├── mcpConfigService.js    # 雙環境 MCP 配置讀寫、備份、統計計算、註解 Sidecar 合併
│   ├── probeService.js        # CLI 進程探針、JSON-RPC ping 與 HTTP/SSE 測速相容層
│   └── systemService.js       # 編輯器設定檔開啟服務 (依環境定位路徑)
├── antigravity_mcp_notes.json # Google Antigravity IDE 專屬 MCP 說明備註庫
├── vscode_mcp_notes.json      # Visual Studio Code 專屬 MCP 說明備註庫
├── media/                     # 前端視圖資源
│   ├── index.html             # 緊湊側邊欄 HTML 結構 (Card 結構與環境提示)
│   ├── style.css              # 4 層 Spacing Tokens 與 Design System 樣式表
│   ├── app.js                 # 前端模組化控制器 (Toast, Global, Probe, App)
│   └── icons/                 # SVG 圖示資產
│       └── mcp-icon.svg
├── install-extension.ps1      # 跨 IDE Junction 符號連結一鍵部署腳本 (UTF-8 BOM)
├── install-extension.bat      # 雙擊安裝執行檔
├── uninstall-extension.ps1    # 跨 IDE 一鍵卸載腳本 (UTF-8 BOM)
├── uninstall-extension.bat    # 雙擊卸載執行檔
└── README.md                  # 說明文件
```
