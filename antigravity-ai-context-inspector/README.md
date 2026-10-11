# AI 上下文檢視器 (AI Context Inspector)

跨 IDE（Google Antigravity IDE、Cursor 與 Visual Studio Code）原生側邊欄擴充套件，專門用來即時檢視每次對話時 AI 載入之 **Rules（常駐與條件規範）**、**Skills（技能）**、**MCP 伺服器與 API 工具** 以及 **工作區綁定**。

---

## 🌟 功能特點

1. **雙環境智慧感應**：
   - 🪐 **Google Antigravity IDE 環境**：
     - **當前環境配置**：直接掃描多專案工作區資料夾與全域目錄，即時確認目前生效設定。
     - **最近對話快照**：精準解析 Antigravity `transcript.jsonl` 日誌與歷史對話資料庫，100% 還原每次對話 AI 實際被注入的記憶上下文。
     - **歷史對話任務切換**：可下拉選擇歷史對話任務進行復盤與環境對比。
   - 💻 **Cursor / Visual Studio Code 環境**：
     - **智慧收斂**：純 VS Code / Cursor 隱藏 Antigravity 內建技能；Cursor 與 VS Code Copilot 另提供對話足跡快照。
     - **全工作區規則掃描**：直接掃描所有開啟工作區資料夾下的 `.agents/rules` 與 `.agents/skills`，即便在 Cursor / VS Code 下也能清晰掌握 AI Agent 指引結構！
     - **Cursor MCP 清單**：讀取使用者 `~/.cursor/mcp.json` 與各工作區 `.cursor/mcp.json`，顯示已註冊的 MCP 伺服器。
     - **Cursor 內建技能**：掃描 `~/.cursor/skills-cursor`，在技能清單顯示「IDE 內建技能」。
     - **VS Code MCP 清單**：併列三個來源——`%APPDATA%/Code/User/mcp.json`、各工作區 `.vscode/mcp.json`，以及 **Copilot CLI 的 `~/.copilot/mcp-config.json`**。VS Code 啟用 `chat.mcp.discovery.enabled.copilot` 後，最後這一份才是 VS Code 實際載入的來源（本機的 `mcp.json` 反而不存在），只讀前兩者會讓清單整片空白。只列名稱、範圍與啟動方式，不讀取 env / headers，**也不標注啟停狀態**（本工具只呈現「已註冊的伺服器」，不管它目前是否被關掉）。
     - **VS Code 技能清單**：對齊 Copilot 三分類——使用者（`~/.claude/skills` 等）、擴充（已安裝套件 `skills/`）、內建（Copilot 隨附 skills）。
     - **Cursor 對話足跡**：掃描 `~/.cursor/projects/*/agent-transcripts`，還原該對話實際讀過的 Rules / Skills，以及實際呼叫的 MCP。下拉標題優先讀取 Composer 官方名稱。
     - **VS Code Copilot 對話足跡**：掃描 `%APPDATA%/Code/User/workspaceStorage/*/chatSessions/*.jsonl`，用官方 `customTitle` 列出對話，並還原實際讀過的 Rules / Skills 與 `mcp_*` 工具。這不是 Antigravity 那種 session prompt 注入快照。
2. **一鍵跳轉開啟**：點擊任一項目旁的 `📄 開啟` 按鈕，立即在編輯器開啟對應的 `.md` 檔案。
3. **即時過濾與搜尋**：輸入關鍵字即時篩選 Rules / Skills / MCP 名稱與描述。
4. **一鍵複製摘要**：點擊頂部 `📋` 按鈕，將整份生效上下文整理為 Markdown 格式並複製至剪貼簿。
5. **免編譯 Junction 安裝**：跨 IDE 支援符號連結掛載，隨改隨生效，開發與自訂極度敏捷。

---

## 🚀 一鍵安裝與啟用

1. 雙擊執行 `install-extension.bat`（腳本會詢問安裝目標：Antigravity / VS Code / Cursor / 全部，並建立 Junction 連線）。
2. 於 IDE 按快捷鍵 `Ctrl + Shift + P`，輸入並執行 `Developer: Reload Window`。
3. 點擊左側活動列圖示 **🤖 (AI 上下文檢視器)** 即可開啟面板！

---

## 🧪 回歸測試

零相依、直接以 Node 執行；`APPDATA` 與 `COPILOT_HOME` 都指向系統暫存目錄下的夾具，**不會碰到真實設定檔**。

```powershell
node tests/mcp-vscode-sources.test.js
```

- 離開碼 `0` = 全數通過、`1` = 有失敗（可直接接 CI 或 hook）。
- 涵蓋 5 項斷言：三來源併列與同名時「VS Code 自身優先」、CLI 條目的 scope / transport / 白名單 `tools` 不計數、**不標注啟停狀態**（負對照：VS Code 兩層開關都標為停用時仍不得出現停用資訊）、以及缺少 CLI 設定檔時不中斷。

---

## 🗑️ 卸載外掛

1. 雙擊執行 `uninstall-extension.bat`。
2. 重載 IDE 視窗即可乾淨解除安裝。
