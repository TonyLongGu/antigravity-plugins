# Antigravity IDE Native Extensions Suite 🚀

> 專為 **Google Antigravity IDE** 量身打造的原生 Webview 擴充套件生態系，賦予 AI 輔助編程前所未有的掌控力與流暢度。

---

## 📦 收錄套件清單 (6 大核心套件)

| 套件名稱 | 目錄名稱 | 核心功能說明 |
| :--- | :--- | :--- |
| 🛠️ **全能控制中心** | `antigravity-toolbox` | 整合原生 Webview 側邊欄面板、IDE 狀態監控與高頻工具快捷中心 |
| 📊 **AI 額度即時監控** | `antigravity-quota-status` | 狀態列即時顯示 AI 模型額度用量、重置倒數與警示提示 |
| 🔌 **MCP 伺服器管理器** | `antigravity-mcp-manager` | 視覺化管理 MCP 設定檔、一鍵檢視工具狀態與服務熱重載 |
| ⚡ **高頻操作快捷面板** | `antigravity-quick-access` | 提供高頻 AI 指令、工作區切換與自訂 Snippet 快速觸發面板 |
| 📜 **專案腳本執行助手** | `antigravity-script-runner` | 自動解析 package.json / Makefile / Powershell 腳本並提供視覺化執行器 |
| 🔍 **AI 上下文檢視儀** | `antigravity-ai-context-inspector` | 即時追蹤 Agent Context Window 注入狀況、Token 消耗與規則審計 |

---

## 🚀 極速安裝指南

本專案支援兩種安裝方式：

### 方式一：AI 智能引導安裝（最推薦 • 複製 Prompt 即裝）

直接將以下提示詞複製並貼到 **Antigravity IDE 的 AI Chat** 對話框：

```text
請幫我從 GitHub (https://github.com/TonyLongGu/antigravity-plugins.git) 安裝 Antigravity IDE 原生擴充套件。

請依序執行以下引導流程：
1. 先詢問我要安裝哪些套件（提供選項：一鍵安裝全部 6 大套件，或自選個別套件）。
2. 詢問我希望將專案原始碼 Clone/放置在本機的哪個目錄（提供預設建議路徑，如 D:\antigravity-plugins）。
3. 根據我的回覆，自動在該目錄執行 Git Clone，並自動為選定的套件建立 IDE 擴充功能掛載。
4. 安裝完成後，提醒我重新載入視窗 (Developer: Reload Window)。
```

---

### 方式二：本機手動雙擊安裝

1. 下載或 Clone 本倉庫至本地任意目錄（例如 `D:\antigravity-plugins`）。
2. **安裝全部套件**：雙擊根目錄下的 `install-all.bat`（或以 PowerShell 執行 `install-all.ps1`）。
3. **單獨安裝特定套件**：進入該套件資料夾（例如 `antigravity-toolbox/`），雙擊其內部的 `install-extension.bat`。
4. 在 Antigravity IDE 中按 `Ctrl + Shift + P`，輸入並執行 **`Developer: Reload Window`** 即可立即生效！

---

## 🧹 解除安裝

- **全套一鍵卸載**：雙擊根目錄下的 `uninstall-all.bat`（或以 PowerShell 執行 `uninstall-all.ps1`）。
- **單獨卸載**：進入特定套件目錄雙擊 `uninstall-extension.bat`。
- 卸載後執行 `Developer: Reload Window` 即可乾淨無痕移除。

---

## 📄 開源授權

本專案採用 [MIT License](LICENSE) 開源授權協議。
