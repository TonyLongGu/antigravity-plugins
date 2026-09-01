# Antigravity MCP 管理儀表板 - IDE 原生側邊欄擴充套件

專為 **Google Antigravity IDE** 開發的原生側邊欄擴充套件（VS Code Extension），提供全域 MCP 伺服器開關控制、狀態監控、即時連線測試與設定檔編輯功能。

本擴充套件遵循 Google Antigravity 原生擴充套件開發規範，採用後端 Services 職責分離架構、極致緊湊 4 層 Spacing Tokens 與前端 `vscode.getState()` 狀態持久化機制。

---

## 🌟 核心特色

1. **無縫嵌入 IDE 側邊欄**：常駐在 IDE 左側活動列（Activity Bar），點擊圖示即可直接操作，無需切換外部瀏覽器。
2. **模組化服務架構 (Modular Services)**：
   - `McpConfigService`：安全讀寫、自動備份（`.bak`）、格式校驗、統計計算與單項/批次切換。
   - `ProbeService`：CLI 進程探針（支援 JSON-RPC ping 與 Windows `taskkill` 進程樹回收）與遠端 HTTP/SSE 延遲測速。
   - `SystemService`：編輯器設定檔開啟與系統整合。
3. **極致純淨全域管理**：專注維護 `~/.gemini/config/mcp_config.json`，介面乾淨俐落、零雜質。
4. **狀態持久化 (State Persistence)**：透過 `vscode.getState()` / `vscode.setState()` 保存搜尋關鍵字與篩選條件，側邊欄切換不丟失上下文。
5. **即時連線測速與一鍵全測**：
   - 支援個別伺服器連線測試（顯示延遲 ms 與狀態圓點）。
   - 頂部提供「一鍵測速」按鈕，快速排程測試所有伺服器狀態。
6. **狀態列即時指示 (Status Bar)**：底部狀態列常駐顯示 `⚡ MCP: 1/9`，即時反應用戶當前啟用的 MCP 數量。
7. **熱重載與檔案監聽 (File Watcher)**：外部或 AI 修改 `mcp_config.json` 時，側邊欄與狀態列自動即時更新。

---

## 🚀 安裝與啟用教學

### 一鍵安裝（免編譯 Junction 掛載）
1. 雙擊執行目錄下的 [`install-extension.bat`](./install-extension.bat)（或以 PowerShell 執行 [`install-extension.ps1`](./install-extension.ps1)）。
2. 在 Antigravity IDE 中按下快捷鍵 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，輸入並選擇：
   ```text
   Developer: Reload Window
   ```
3. 重新載入後，即可在左側活動列看見 **「MCP 伺服器管理」** 專屬圖示！

---

## 🗑️ 移除與卸載教學

### 一鍵移除
1. 雙擊執行目錄下的 [`uninstall-extension.bat`](./uninstall-extension.bat)（或以 PowerShell 執行 [`uninstall-extension.ps1`](./uninstall-extension.ps1)）。
2. 在 Antigravity IDE 中按下快捷鍵 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，執行 `Developer: Reload Window` 即可完全卸載。

---

## 📁 目錄結構

```text
MCP擴充套件_IDE側邊欄/
├── package.json              # 擴充套件清單、活動列容器與選單指令註冊
├── extension.js              # Extension Host 進入點、Provider 訊息路由與生命週期
├── services/                 # 後端業務服務層 (職責分離)
│   ├── mcpConfigService.js   # MCP 配置檔讀寫、備份、統計計算與開關切換
│   ├── probeService.js       # CLI 進程探針、JSON-RPC ping 與 HTTP/SSE 測速
│   └── systemService.js      # 編輯器設定檔開啟服務
├── media/                    # 前端視圖資源
│   ├── index.html            # 緊湊側邊欄 HTML 結構 (全域 Card 結構)
│   ├── style.css             # 4 層 Spacing Tokens 與 Design System 樣式表
│   ├── app.js                # 前端模組化控制器 (Toast, Global, Probe, App)
│   └── icons/                # SVG 圖示資產
│       └── mcp-icon.svg
├── install-extension.ps1     # Junction 符號連結一鍵部署腳本 (UTF-8 BOM)
├── install-extension.bat     # 雙擊安裝執行檔
├── uninstall-extension.ps1   # 一鍵卸載腳本 (UTF-8 BOM)
├── uninstall-extension.bat   # 雙擊卸載執行檔
└── README.md                 # 說明文件
```
