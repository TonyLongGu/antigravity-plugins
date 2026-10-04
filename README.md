# Antigravity Plugins 🚀

> 源於 **Google Antigravity IDE**，同一套也可掛到 **Cursor** 與 **VS Code**。目前僅 **AI 額度即時監控** 不支援 VS Code（該 IDE 沒有對應額度 API）；其餘套件三端皆可安裝。

---

## 📦 收錄套件清單 (6 大核心套件)

| 套件名稱 | 目錄名稱 | 核心功能說明 | 支援 IDE |
| :--- | :--- | :--- | :--- |
| 🛠️ **全能控制中心** | `antigravity-toolbox` | 側邊欄管理工作區、專案腳本、依 IDE 切換的目錄捷徑與檔案總管過濾，並可統計、清理對話紀錄 | Antigravity / Cursor / VS Code |
| 📊 **AI 額度即時監控** | `antigravity-quota-status` | 狀態列顯示額度與重置倒數。Antigravity 連本機 Language Server；Cursor 查雲端 usage API。VS Code 沒有對應額度 API | Antigravity / Cursor |
| 🔌 **MCP 伺服器管理器** | `antigravity-mcp-manager` | Antigravity 以左側儀表板開關 MCP。Cursor 與 VS Code 只在狀態列顯示啟用數。目前 IDE 已啟用 Cline 時才並列 Cline 統計（純檢視；未安裝或已停用則不顯示） | Antigravity / Cursor / VS Code |
| ⚡ **高頻操作快捷面板** | `antigravity-quick-access` | 檔案總管釘選／暫存清單，可拖曳至 Chat 與終端機，並支援多選批次操作 | Antigravity / Cursor / VS Code |
| 📜 **專案腳本執行助手** | `antigravity-script-runner` | 檔案總管／編輯器右鍵執行 Python、批次檔與 PowerShell（可系統管理員），並提供圖片、音訊、影片檢視 | Antigravity / Cursor / VS Code |
| 🔍 **AI 上下文檢視儀** | `antigravity-ai-context-inspector` | 檢視 Rules、Skills、MCP 與工作區綁定。Antigravity 還原對話注入內容；Cursor 與 VS Code 顯示對話足跡 | Antigravity / Cursor / VS Code |

---

## 🔐 隱私與權限說明

本專案為**本機自用工具**，設計上不具備回傳資料的能力。安裝前請先了解它會碰觸的範圍。

### 資料處理原則

- **不蒐集、不上傳**：本外掛本身無遙測、無分析、無回報端點，所有掃描結果只在本機 UI 顯示。
- **無第三方伺服器**：唯一的對外連線是 Cursor 官方端點（`cursor.com`、`api2.cursor.sh`），用於查詢你自己的額度；其餘套件完全不連外網。
- **憑證不落地**：讀取到的 access token 僅存在記憶體，只用於前述官方端點或本機 `127.0.0.1` 服務，不寫入任何檔案、不輸出到日誌。
- 讀取 MCP 設定時**只取伺服器名稱與啟動方式，不讀 `env` / `headers`**，避免把權杖帶進 UI。

### 會讀取的本機資料

- **上下文檢視儀 / MCP 管理器**：各 `mcp.json`（`%APPDATA%/Code/User`、`~/.cursor`、工作區 `.vscode`）、`state.vscdb` 的對話索引與 `mcp.enablement`。
- **額度監控**：Cursor `state.vscdb` 的 `cursorAuth/accessToken`、Cursor 自身 Sentry scope 檔中的 user ID、Antigravity Language Server 行程資訊。
- **全能控制中心**：各 IDE 的 `globalStorage` / `workspaceStorage`、Skills 目錄。
- **腳本執行助手**：你的工作區檔案（供圖片 / 音訊 / 影片檢視）。

### 會寫入的本機資料

- **全能控制中心**：清理對話時改寫 `state.vscdb` 的 `chat.ChatSessionStore.index` 單一鍵，**寫入前自動備份**該檔（副檔名 `.toolbox-bak`），不影響其他儲存資料。
- **全能控制中心**：同步 Skills 時於目標目錄建立 Windows Junction（`mklink /J`）。
- 其餘套件只寫入自身在 IDE 的設定儲存區。

### 執行能力警示

- **腳本執行助手**可依你的操作執行 Python、批次檔與 PowerShell，並支援**以系統管理員權限**啟動（`RunAs`）。請只對信任的腳本使用。
- 安裝 / 解除安裝腳本以 `-ExecutionPolicy Bypass` 執行 PowerShell，這是繞過 IDE 外掛載入限制的必要手段；請自行檢視腳本內容後再執行。
- 本機影音串流服務綁定 `127.0.0.1`（不對外開放），並以每次啟動隨機產生的 session token 校驗請求。

### 使用者責任

- 讀取第三方服務（Cursor 等）的本機憑證並呼叫其 API，**可能受該服務條款約束**，請自行確認並承擔合規責任。
- 本專案以 MIT 授權提供，不提供任何形式之擔保。

---

## 🌐 介面語言

六個套件共用同一組介面語言。在有語言按鈕的面板上點一下，會彈出選單：

- 繁體中文
- 简体中文
- English

按鈕外觀維持原本的短標（繁／简／EN），短標表示**目前語言**。選好之後會寫入共用設定，其他套件一起切換。

| 套件 | 怎麼切 |
| :--- | :--- |
| 控制中心、MCP 管理器、上下文檢視器 | 面板標題列右側的語言按鈕 |
| 腳本執行助手 | 圖片、聲音、影片檢視器標題列的語言按鈕。檔案總管與編輯器右鍵選單會跟著切換 |
| 額度監控 | 點狀態列後，選「介面語言」 |
| 快捷面板 | 檢視標題列的地球圖示，或命令「介面語言」。檢視項目、檔案總管與編輯器分頁的右鍵會跟著切換 |

---

## 🚀 極速安裝指南

本專案支援兩種安裝方式：

### 方式一：AI 智能引導安裝（最推薦 • 複製 Prompt 即裝）

直接將以下提示詞複製並貼到 **目前 IDE 的 AI Chat**（Cursor / Antigravity / VS Code Copilot Chat）：

```text
請幫我從 GitHub (https://github.com/TonyLongGu/antigravity-plugins.git) 安裝 Antigravity Plugins。

請依序執行以下引導流程：
1. 先確認我目前使用的 IDE（Antigravity / Cursor / VS Code）。
2. 詢問我要安裝哪些套件（全部，或自選）。不相容目前 IDE 的套件請略過並說明原因（目前僅 Quota Status 不支援 VS Code。MCP Manager 在 Cursor / VS Code 只顯示底部狀態列，不開左側儀表板；Cline 統計只在該 IDE 已啟用 Cline 時出現）。
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
