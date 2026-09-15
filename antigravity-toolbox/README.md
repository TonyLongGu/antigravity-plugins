# Antigravity 控制中心 (Antigravity Toolbox)

VS Code 相容 IDE 原生側邊欄擴充套件（Cursor、VS Code、VS Code Insiders、VSCodium、Google Antigravity），支援環境智慧感應與按需掛載。

---

## 🌟 核心功能

> 💡 **互動特色**：採用現代化折疊面板（Accordion）設計，預設僅開啟「多專案工作區」，其餘工具預設收合，點擊卡片標題即可流暢展開/收合。

1. **多專案工作區管理 (Workspace)**：
   - 即時偵測當前開啟的 `.code-workspace` 多專案工作區。
   - 智慧標記同名專案衝突與同層連帶專案（如 `Unity\MapleRealm` 與 `Spine\MapleRealm`，以及同層的 `GitHub\Antigravity` 與 `GitHub\ai`）。
   - **一鍵「自動修正同名專案名稱」**：自動在工作區 JSON 中將同名專案及同層專案補上「父資料夾 \ 專案名」前綴，保持命名一致性。
   - 點擊專案項目可直接在 Windows 檔案總管開啟該專案目錄。

2. **專案腳本執行器 (Project Script Runner)**：
   - ⚡ **檔案總管右鍵直達**：在檔案總管對 `.ps1`、`.bat`、`.cmd` 檔案按右鍵選擇「加入至專案腳本執行器」，即刻一鍵加入。
   - 🗂️ **依專案順序動態聯動排序**：自動解析腳本隸屬的專案名稱（如 `Ai \ ai`），並隨上方「多專案工作區」專案拖曳排序順序即時動態更新先後次序。
   - ▶️ **一般執行**：在 IDE 原生整合終端機中運行腳本（`.ps1` 自動使用 `-ExecutionPolicy Bypass` 執行）。
   - ⚡ **管理員執行**：以 Windows 系統管理員權限 (UAC 提權) 於獨立視窗運行。
   - 💾 **工作區持久化保存**：腳本清單自動保存於 `.code-workspace` 檔案，隨工作區切換無縫動態載入。

3. **全域自訂目錄捷徑（依目前 IDE 自動切換）**：
   - **Cursor**：`~/.cursor` 根目錄、`mcp.json`、個人 Skills（`~/.cursor/skills`）、專案 Rules（`.cursor/rules`）、Plugins、`%APPDATA%\Cursor\User`
   - **Antigravity**：`~/.gemini/config`、`mcp_config.json`、Skills / Rules / Plugins、`~/.gemini/antigravity-ide`

4. **IDE 設定檔與檔案總管過濾開關**：
   - 📄 **開啟 settings.json** (直接在 IDE 編輯器分頁開啟)
   - 👁️ **檔案總管即時過濾開關 (Explorer Visibility)**：
     - 🔘 **隱藏 .gitignore 檔案** (`files.exclude["**/.gitignore"]`)
     - 🔘 **隱藏 Git 忽略的檔案** (`explorer.excludeGitIgnore`)
     - 🔘 **隱藏系統暫存雜項** (`Thumbs.db`, `.DS_Store`, `desktop.ini`)
     - 🔘 **隱藏 Python 編譯快取** (`__pycache__`, `*.pyc`)
   - ⚡ **即時同步**：支援全域設定監聽，點擊開關後檔案總管立即無感刷新。

5. **對話記憶庫管理與清理**：
   - **Cursor**：統計並清理 `~/.cursor/projects/*/agent-transcripts` 各對話資料夾；開啟按鈕會進目前專案的 transcripts 目錄。
   - **Antigravity**：統計並清理 `~/.gemini/antigravity-ide/brain`。
   - 🎚️ **動態時間滑桿（2 ~ 4 個月，預設 3 個月）**，清理前有二次確認。

---

## 🚀 安裝與生效方式 (Cursor / VS Code / Antigravity)

Cursor、VS Code 與 Antigravity 都實作 VS Code Extension API（`require('vscode')`），因此**同一份外掛可直接掛到 Cursor**，不必另打包。

腳本會自動辨識本機已安裝的相容 IDE（Cursor、VS Code、VS Code Insiders、VSCodium、Antigravity IDE）並按需掛載到各自的 `extensions` 目錄：

| IDE | 擴充套件目錄 | User 設定目錄 |
| :--- | :--- | :--- |
| Cursor | `~/.cursor/extensions` | `%APPDATA%\Cursor\User` |
| VS Code | `~/.vscode/extensions` | `%APPDATA%\Code\User` |
| VS Code Insiders | `~/.vscode-insiders/extensions` | `%APPDATA%\Code - Insiders\User` |
| VSCodium | `~/.vscode-oss/extensions` | `%APPDATA%\VSCodium\User` |
| Antigravity IDE | `~/.antigravity-ide/extensions` | `%APPDATA%\Antigravity IDE\User` |

1. **一鍵安裝**：在 PowerShell 執行 `.\install-extension.ps1`（或雙擊 `install-extension.bat`）。
2. **一鍵卸載**：在 PowerShell 執行 `.\uninstall-extension.ps1`（或雙擊 `uninstall-extension.bat`）。
3. **重載生效**：於目標 IDE 按 `Ctrl + Shift + P` -> 執行 `Developer: Reload Window`。
4. **開啟面板**：
   - 點擊左側活動列的 **🛠️ (Antigravity 控制中心)** 圖示。
   - 或點擊右下角狀態列 **`$(tools) 控制中心`** 按鈕。

> 💡 **環境感應**：在 Cursor 會顯示 Cursor 本機路徑（`~/.cursor`、agent-transcripts）；在 Antigravity 則顯示 `~/.gemini`。純 VS Code 且本機沒有 Antigravity 時，這兩張卡片會自動隱藏。
