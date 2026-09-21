# Antigravity Plugins 🚀

> 源於 **Google Antigravity IDE**，同一套也可掛到 **Cursor** 與 **VS Code**。目前僅 **AI 額度即時監控** 不支援 VS Code（該 IDE 沒有對應額度 API）；其餘套件三端皆可安裝。

---

## 📦 收錄套件清單 (6 大核心套件)

| 套件名稱 | 目錄名稱 | 核心功能說明 | 支援 IDE |
| :--- | :--- | :--- | :--- |
| 🛠️ **全能控制中心** | `antigravity-toolbox` | 整合原生 Webview 側邊欄面板、IDE 狀態監控與高頻工具快捷中心 | Antigravity / Cursor / VS Code |
| 📊 **AI 額度即時監控** | `antigravity-quota-status` | 狀態列顯示額度用量與重置倒數。Antigravity 走本機 Language Server；Cursor 走雲端 usage API | Antigravity / Cursor |
| 🔌 **MCP 伺服器管理器** | `antigravity-mcp-manager` | 視覺化列出 MCP、連線探測與備註。Antigravity 可原生開關；Cursor / VS Code 為檢視模式（開關請用各 IDE 原生 UI） | Antigravity / Cursor / VS Code |
| ⚡ **高頻操作快捷面板** | `antigravity-quick-access` | 檔案總管獨立釘選／暫存清單，支援拖曳至 Chat、終端機與批次操作 | Antigravity / Cursor / VS Code |
| 📜 **專案腳本執行助手** | `antigravity-script-runner` | 檔案總管／編輯器右鍵執行腳本，並提供圖片、音訊、影片檢視 | Antigravity / Cursor / VS Code |
| 🔍 **AI 上下文檢視儀** | `antigravity-ai-context-inspector` | 即時檢視 Rules、Skills、MCP 與工作區綁定，並追蹤對話注入內容 | Antigravity / Cursor / VS Code |

---

## 🚀 極速安裝指南

本專案支援兩種安裝方式：

### 方式一：AI 智能引導安裝（最推薦 • 複製 Prompt 即裝）

直接將以下提示詞複製並貼到 **目前 IDE 的 AI Chat**（Cursor / Antigravity / VS Code Copilot Chat）：

```text
請幫我從 GitHub (https://github.com/TonyLongGu/antigravity-plugins.git) 安裝 Antigravity Plugins。

請依序執行以下引導流程：
1. 先確認我目前使用的 IDE（Antigravity / Cursor / VS Code）。
2. 詢問我要安裝哪些套件（全部，或自選）。不相容目前 IDE 的套件請略過並說明原因（目前僅 Quota Status 不支援 VS Code；MCP Manager 在 Cursor / VS Code 為檢視模式）。
3. 詢問本機放置目錄（預設建議 D:\antigravity-plugins），然後 Git Clone 並掛載到該 IDE 的 extensions 目錄。
4. 完成後提醒重載視窗 (Developer: Reload Window)；若是 VS Code，建議完整關閉再開。
```

---

### 方式二：本機手動雙擊安裝

1. 下載或 Clone 本倉庫至本地任意目錄（例如 `D:\antigravity-plugins`）。
2. **安裝全部套件**：雙擊根目錄下的 `install-all.bat`（或以 PowerShell 執行 `install-all.ps1`）。
3. **單獨安裝特定套件**：進入該套件資料夾（例如 `antigravity-toolbox/`），雙擊其內部的 `install-extension.bat`。
4. Antigravity / Cursor：按 `Ctrl + Shift + P`，執行 **`Developer: Reload Window`**。VS Code：建議完整關閉後再重開。安裝腳本會詢問目標 IDE；不相容套件會自動略過。

---

## 🧹 解除安裝

- **全套一鍵卸載**：雙擊根目錄下的 `uninstall-all.bat`（或以 PowerShell 執行 `uninstall-all.ps1`）。
- **單獨卸載**：進入特定套件目錄雙擊 `uninstall-extension.bat`。
- 卸載後：Antigravity / Cursor 執行 `Developer: Reload Window`；VS Code 建議完整關閉再開。

---

## 📄 開源授權

本專案採用 [MIT License](LICENSE) 開源授權協議。
