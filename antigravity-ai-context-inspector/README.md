# AI 上下文檢視器 (AI Context Inspector)

跨 IDE (Google Antigravity IDE 與 Visual Studio Code) 原生側邊欄擴充套件，專門用來即時檢視每次對話時 AI 載入之 **Rules（常駐與條件規範）**、**Skills（技能）**、**MCP 伺服器與 API 工具** 以及 **工作區綁定**。

---

## 🌟 功能特點

1. **雙環境智慧感應**：
   - 🪐 **Google Antigravity IDE 環境**：
     - **當前環境配置**：直接掃描多專案工作區資料夾與全域目錄，即時確認目前生效設定。
     - **最近對話快照**：精準解析 Antigravity `transcript.jsonl` 日誌與歷史對話資料庫，100% 還原每次對話 AI 實際被注入的記憶上下文。
     - **歷史對話任務切換**：可下拉選擇歷史對話任務進行復盤與環境對比。
   - 💻 **Visual Studio Code 環境**：
     - **智慧收斂**：自動隱藏 Antigravity 專屬的對話快照歷史切換選單，僅保留並鎖定 **⚡ 當前環境配置**。
     - **全工作區規則掃描**：直接掃描所有開啟工作區資料夾下的 `.agents/rules` 與 `.agents/skills`，即便在 VS Code 下也能清晰掌握 AI Agent 指引結構！
2. **一鍵跳轉開啟**：點擊任一項目旁的 `📄 開啟` 按鈕，立即在編輯器開啟對應的 `.md` 檔案。
3. **即時過濾與搜尋**：輸入關鍵字即時篩選 Rules / Skills / MCP 名稱與描述。
4. **一鍵複製摘要**：點擊頂部 `📋` 按鈕，將整份生效上下文整理為 Markdown 格式並複製至剪貼簿。
5. **免編譯 Junction 安裝**：跨 IDE 支援符號連結掛載，隨改隨生效，開發與自訂極度敏捷。

---

## 🚀 一鍵安裝與啟用

1. 雙擊執行 `install-extension.bat`（腳本會自動偵測本機存在的 VS Code 與 Antigravity IDE 並建立 Junction 連線）。
2. 於 IDE 按快捷鍵 `Ctrl + Shift + P`，輸入並執行 `Developer: Reload Window`。
3. 點擊左側活動列圖示 **🤖 (AI 上下文檢視器)** 即可開啟面板！

---

## 🗑️ 卸載外掛

1. 雙擊執行 `uninstall-extension.bat`。
2. 重載 IDE 視窗即可乾淨解除安裝。
