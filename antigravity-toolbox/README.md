# Antigravity 控制中心 (Antigravity Toolbox)

Google Antigravity IDE 專屬原生側邊欄擴充套件。

---

## 🌟 核心功能

> 💡 **互動特色**：採用現代化折疊面板（Accordion）設計，預設僅開啟「多專案工作區」，其餘工具預設收合，點擊卡片標題即可流暢展開/收合。

1. **多專案工作區管理 (Workspace)**：
   - 即時偵測當前開啟的 `.code-workspace` 多專案工作區。
   - 智慧標記同名專案衝突與同層連帶專案（如 `UnityPj\MapleRealm` 與 `SpinePj\MapleRealm`，以及同層的 `GitHubPj\Antigravity` 與 `GitHubPj\ai`）。
   - **一鍵「自動修正同名專案名稱」**：自動在工作區 JSON 中將同名專案及同層專案補上「父資料夾 \ 專案名」前綴，保持命名一致性。
   - 點擊專案項目可直接在 Windows 檔案總管開啟該專案目錄。

2. **專案腳本執行器 (Project Script Runner)**：
   - ⚡ **檔案總管右鍵直達**：在檔案總管對 `.ps1`、`.bat`、`.cmd` 檔案按右鍵選擇「加入至專案腳本執行器」，即刻一鍵加入。
   - 🗂️ **依專案順序動態聯動排序**：自動解析腳本隸屬的專案名稱（如 `AiPj \ ai`），並隨上方「多專案工作區」專案拖曳排序順序即時動態更新先後次序。
   - ▶️ **一般執行**：在 IDE 原生整合終端機中運行腳本（`.ps1` 自動使用 `-ExecutionPolicy Bypass` 執行）。
   - ⚡ **管理員執行**：以 Windows 系統管理員權限 (UAC 提權) 於獨立視窗運行。
   - 💾 **工作區持久化保存**：腳本清單自動保存於 `.code-workspace` 檔案，隨工作區切換無縫動態載入。

3. **Antigravity 全域自訂目錄捷徑 (`~/.gemini/config`)**：
   - 📂 **Config 根目錄** (`~/.gemini/config`)
   - ⚡ **mcp_config.json** (在編輯器開啟 MCP 設定檔)
   - 🎯 **Skills 技能目錄** (`~/.gemini/config/skills`)
   - 📜 **Rules 規範目錄** (`~/.gemini/config/rules`)
   - 🧩 **Plugins 插件目錄** (`~/.gemini/config/plugins`)
   - 📦 **AppData 核心目錄** (`~/.gemini/antigravity-ide`)

3. **IDE 設定檔與檔案總管過濾開關**：
   - 📄 **開啟 settings.json** (直接在 IDE 編輯器分頁開啟)
   - 👁️ **檔案總管即時過濾開關 (Explorer Visibility)**：
     - 🔘 **隱藏 .gitignore 檔案** (`files.exclude["**/.gitignore"]`)
     - 🔘 **隱藏 Git 忽略的檔案** (`explorer.excludeGitIgnore`)
     - 🔘 **隱藏系統暫存雜項** (`Thumbs.db`, `.DS_Store`, `desktop.ini`)
     - 🔘 **隱藏 Python 編譯快取** (`__pycache__`, `*.pyc`)
   - ⚡ **即時同步**：支援全域設定監聽，點擊開關後檔案總管立即無感刷新。


4. **對話記憶庫管理與清理 (Brain)**：
   - 📊 **即時狀態**：顯示當前 Brain 暫存總容量（MB）與對話總數。
   - 📂 **開啟 Brain 目錄**：直接調用 Windows 檔案總管進入 `~/.gemini/antigravity-ide/brain`。
   - 🎚️ **動態時間滑桿（2 ~ 4 個月，預設 3 個月）**：直覺調整欲清理的歷史對話週期。
   - 🗑️ **安全清理歷史紀錄**：具備二次確認防護視窗，精確計算過期資料夾數量與釋放空間後安全刪除。

---

## 🚀 安裝與生效方式

1. **一鍵安裝**：執行 `install-extension.ps1`（或雙擊 `install-extension.bat`）。
2. **重載生效**：在 IDE 按 `Ctrl + Shift + P` -> 執行 `Developer: Reload Window`。
3. **開啟面板**：
   - 點擊左側活動列的 **🛠️ (Antigravity 控制中心)** 圖示。
   - 或點擊右下角狀態列 **`$(tools) 控制中心`** 按鈕。
