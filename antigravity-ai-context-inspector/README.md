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
   - 🟣 **Cline 對話來源（跨宿主，任何 IDE 都能看）**：
     - **資料位置**：`~/.cline/data/sessions/<sessionId>/`（user 層級，Antigravity / Cursor / VS Code 共用同一份，因此不必管目前開的是哪個 IDE）。
     - **來源篩選 chips**：快照模式下可一鍵切換「Antigravity / Copilot / Cursor / Cline」（順序固定不隨宿主變動；各來源一色：綠／藍／橘／紫，chip 只顯示來源名稱）。**預設自動選中宿主原生來源**（裝在 Antigravity 就是 Antigravity、Cursor 是 Cursor、VS Code 是 Copilot），並記住最後一次選擇直到再次更改；**不提供「全部」chip**——再點一次作用中的 chip 即取消篩選（顯示全部來源）。只有一種來源時自動隱藏。對話清單項目**不再重複顯示來源徽章**（上方 chips 已表達類別），來源改放在項目 tooltip 供辨識。
     - **足跡還原**：`skills` 工具呼叫 → 該技能標記為已調用；`<server>__<tool>` → 只留下真正被呼叫的 MCP 伺服器與工具；`read_files` / `editor` 觸及的 `.agents/rules`、`.clinerules` → 標記為已讀取的條件式規範。
     - **Cline 設定**：`.clinerules`（檔案或資料夾）、`.clinerules/workflows/*.md`、全域 `~/Documents/Cline/Rules`、`~/.agents/skills` 全都會納入掃描；`~/.cline/data/workspaces/*/workspaceState.json` 與 `globalState.json` 的 rules / skills 開關若為關閉，該項目會被淡化並排除在快照之外。
2. **一鍵跳轉開啟**：點擊任一項目旁的 `📄 開啟` 按鈕，立即在編輯器開啟對應的 `.md` 檔案。
3. **即時過濾與搜尋**：輸入關鍵字即時篩選 Rules / Skills / MCP 名稱與描述。
4. **一鍵複製摘要**：點擊頂部 `📋` 按鈕，將整份生效上下文整理為 Markdown 格式並複製至剪貼簿。
5. **免編譯 Junction 安裝**：跨 IDE 支援符號連結掛載，隨改隨生效，開發與自訂極度敏捷。

---

## 🚀 一鍵安裝與啟用

1. 雙擊執行 `install-extension.bat`（預設自動偵測並安裝到本機全部 VS Code 相容 IDE，**不需選擇目標**，並建立 Junction 連線；要只裝單一 IDE 可加 `-Target Antigravity|VSCode|Cursor`）。
2. 於 IDE 按快捷鍵 `Ctrl + Shift + P`，輸入並執行 `Developer: Reload Window`。
3. 點擊左側活動列圖示 **🤖 (AI 上下文檢視器)** 即可開啟面板！

---

## 🧭 Cline 對話足跡（語意與界線）

- **這是「足跡」不是「注入快照」**：Cline 的 session 檔沒有保存「這一輪被塞進模型的完整 prompt」，因此本工具呈現的是可驗證的足跡——實際調用的技能、實際呼叫的 MCP 工具、實際讀過的規範，以及 Cline 目前啟用中的常駐規範（`.clinerules` / `AGENTS.md` / 全域規則）。若某條常駐規範是在該對話之後才新增，仍會列出，但不會標記為「已調用」。
- **與宿主 IDE 無關**：Cline 的資料在 `~/.cline/data`，所以在 Antigravity 裡也能看 Cline、Cursor、Copilot 的對話；chips 只列出這台機器實際有資料的來源。
- **效能**：對話清單只讀 meta（1~3 KB）並以 mtime 快取；`messages.json` 只在選取時讀，且超過 20 MB 會改走逐行串流掃描（不做整份 `JSON.parse`），記憶體用量與檔案大小脫鉤（本機最大單檔約 71 MB）。
- **隱私**：不讀 `~/.cline/data/secrets.json`；`cline_mcp_settings.json` 只取 `command` / `args` / `url` / `disabled`，**不讀 `env`**；`globalState.json` 只取白名單欄位（版本、provider/model、開關）。
- **可調設定**（`settings.json`）：
  - `antigravity.aiContext.snapshotSources`：限制可顯示的來源（預設空 = 自動）。
  - `antigravity.aiContext.clineScope`：`workspace`（預設，只列目前工作區）或 `all`。
  - `antigravity.aiContext.clineDataDir`：非標準安裝時指定 Cline 資料目錄（測試會以 `CLINE_DATA_DIR` 環境變數覆寫）。

---

## 🧪 回歸測試

零相依、直接以 Node 執行；`APPDATA` / `COPILOT_HOME` / `USERPROFILE` / `CLINE_DATA_DIR` 都指向系統暫存目錄下的夾具，**不會碰到真實設定檔**。

```powershell
node tests/mcp-vscode-sources.test.js
node tests/cline-snapshot.test.js
node tests/snapshot-source-default.test.js
```

- 離開碼 `0` = 全數通過、`1` = 有失敗（可直接接 CI 或 hook）。
- `mcp-vscode-sources`：涵蓋 5 項斷言——三來源併列與同名時「VS Code 自身優先」、CLI 條目的 scope / transport / 白名單 `tools` 不計數、**不標注啟停狀態**（負對照：VS Code 兩層開關都標為停用時仍不得出現停用資訊）、以及缺少 CLI 設定檔時不中斷。
- `cline-snapshot`：涵蓋 10 項斷言——清單只讀 meta（攔截 `*.messages.json` 讀取）、`clineScope` 工作區過濾、`skills` 工具足跡、`<server>__<tool>` MCP 足跡與只保留實際呼叫的工具、設定檔已移除但確實呼叫過的 MCP 仍會列出、`workspaceState.json` 開關對映（關閉的常駐規範不得出現在快照）、條件式規範只留被讀取者、對話 meta、缺少資料目錄不拋錯，以及 **> 20 MB 走串流降級路徑**。
- `snapshot-source-default`：涵蓋 7 項斷言——**未手動選擇時一律載入宿主原生來源**（Antigravity／Cursor 各驗一次）、Webview 注入空的 `INITIAL_SOURCE_FILTER`、點過 chip 後寫回 `workspaceState` 並沿用（重開視窗仍生效）、取消篩選（`all`）沿用已選對話來源、來源不可用時退回宿主，以及空字串清回「跟隨宿主」。以 `Module._load` 攔截 `require('vscode')`，不需要真實 IDE。

---

## 🗑️ 卸載外掛

1. 雙擊執行 `uninstall-extension.bat`。
2. 重載 IDE 視窗即可乾淨解除安裝。
