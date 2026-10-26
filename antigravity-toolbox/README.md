# Antigravity 控制中心 (Antigravity Toolbox)

VS Code 相容 IDE 原生側邊欄擴充套件（Cursor、VS Code、VS Code Insiders、Google Antigravity），支援環境智慧感應與按需掛載，並內建 GitHub Copilot 對話紀錄統計與清理。

---

## 🌟 核心功能

> 💡 **互動特色**：採用現代化折疊面板（Accordion）設計，預設僅開啟「多專案工作區」，其餘工具預設收合，點擊卡片標題即可流暢展開/收合。

1. **多專案工作區管理 (Workspace)**：
   - 即時偵測當前開啟的 `.code-workspace` 多專案工作區。
   - 智慧標記同名專案衝突與同層連帶專案（如 `Unity\MapleRealm` 與 `Spine\MapleRealm`，以及同層的 `GitHub\Antigravity` 與 `GitHub\ai`）。
   - **一鍵「自動修正同名專案名稱」**：自動在工作區 JSON 中將同名專案及同層專案補上「父資料夾 \ 專案名」前綴，保持命名一致性。
   - 點擊專案項目可直接在 Windows 檔案總管開啟該專案目錄。
   - 🔗 **開關專案時同步全域 Skills（Codex / Cline）**：
     - **開啟**：立即依啟用專案對齊 `~/.agents/skills`，之後跟隨專案開關與專案內 Skills 目錄新增／刪除。
     - **關閉**：停止跟隨，並解除所有連到全域資料夾（`~/.agents/skills`）的連結；僅移除 Junction／Symlink，全域目錄內的實體資料夾一律保留。
     - 🔘 **排除首專案（排序第 1 個專案）**：開啟後，面板清單排序第 1 個專案（即「首項」）不列入同步來源，且其先前建立的 Junction 會一併解除；關閉則首專案照常同步。設定鍵：`antigravity.skillSyncExcludeFirstProject`（僅在同步開關開啟時生效）。

2. **專案腳本執行器 (Project Script Runner)**：
   - ⚡ **檔案總管右鍵直達**：在檔案總管對 `.ps1`、`.bat`、`.cmd` 檔案按右鍵選擇「加入至專案腳本執行器」，即刻一鍵加入。
   - 🗂️ **依專案順序動態聯動排序**：自動解析腳本隸屬的專案名稱（如 `Ai \ ai`），並隨上方「多專案工作區」專案拖曳排序順序即時動態更新先後次序。
   - ▶️ **一般執行**：在 IDE 原生整合終端機中運行腳本（`.ps1` 自動使用 `-ExecutionPolicy Bypass` 執行）。
   - ⚡ **管理員執行**：以 Windows 系統管理員權限 (UAC 提權) 於獨立視窗運行。
   - 💾 **工作區持久化保存**：腳本清單自動保存於 `.code-workspace` 檔案，隨工作區切換無縫動態載入。

3. **全域自訂目錄捷徑（依目前 IDE 自動切換）**：
   - **Cursor**：`~/.cursor` 根目錄、`mcp.json`、個人 Skills（`~/.cursor/skills`）、專案 Rules（`.cursor/rules`）、Plugins、`%APPDATA%\Cursor\User`
   - **Antigravity**：`~/.gemini/config`、`mcp_config.json`、Skills / Rules / Plugins、`~/.gemini/antigravity-ide`
   - **VS Code + Copilot**：`%APPDATA%\Code\User`、`mcp.json`、Skills（`~/.agents/skills`）、個人規範（`User\prompts`）、Plugins（`~/.copilot/installed-plugins`）、`globalStorage`
   - 🖱️ **按鈕 tooltip 顯示實際目標路徑**：點擊前即可確認會開啟哪個目錄。

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
   - **VS Code + Copilot**：統計並清理 Copilot Chat 對話紀錄，跨所有工作區聚合：
     - 對話本體：`workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl`（各專案獨立）＋ `globalStorage/emptyWindowChatSessions`（無工作區視窗）。
     - 單筆對話數與空間會依專案分組，滑鼠移至「對話紀錄數」可看分佈明細。
     - ⚠️ **清理時會一併同步 VS Code 對話索引**（`state.vscdb` 內的 `chat.ChatSessionStore.index`），避免歷史清單殘留點不開的幽靈項目；因對話索引載入後常駐記憶體，清理建議日後**重載視窗**以確保清單一致。
     - 索引同步需 VS Code 內建 `node:sqlite`（約 VS Code 1.11x 以上）；較舊版本會自動降級為僅刪除檔案，並於介面提示。
     - 寫入索引前會自動備份該 `state.vscdb`（副檔名 `.toolbox-bak`），且僅動對話索引單一鍵，不影響其他儲存資料。
     - 範圍說明：Copilot CLI / Agent Host 的對話（`~/.copilot/session-state`）不屬本卡片管理範圍，故不會被清理。
   - 🎚️ **動態時間滑桿（2 ~ 4 個月，預設 3 個月）**，清理前有二次確認。

---

## 🚀 安裝與生效方式 (Cursor / VS Code / Antigravity)

Cursor、VS Code 與 Antigravity 都實作 VS Code Extension API（`require('vscode')`），因此**同一份外掛可直接掛到 Cursor**，不必另打包。

腳本會自動辨識本機已安裝的相容 IDE（Cursor、VS Code、VS Code Insiders、Antigravity IDE）並**預設全部掛載**到各自的 `extensions` 目錄（不再詢問目標，一次裝好）：

| IDE | 擴充套件目錄 | User 設定目錄 |
| :--- | :--- | :--- |
| Cursor | `~/.cursor/extensions` | `%APPDATA%\Cursor\User` |
| VS Code | `~/.vscode/extensions` | `%APPDATA%\Code\User` |
| VS Code Insiders | `~/.vscode-insiders/extensions` | `%APPDATA%\Code - Insiders\User` |
| Antigravity IDE | `~/.antigravity-ide/extensions` | `%APPDATA%\Antigravity IDE\User` |

> ⚠️ **VSCodium 尚未支援自動掛載**：安裝腳本目前只涵蓋上表四種 IDE。VSCodium 同為 VS Code OSS 分支，但腳本沒有它的部署目標（只有「IDE 正在執行」的偵測會認得它），所以不會自動掛載。若你需要，請自行把外掛資料夾掛到 `~/.vscode-oss/extensions` 後重新載入視窗（此路徑未經本專案實機驗證）。

1. **一鍵安裝**：在 PowerShell 執行 `.\install-extension.ps1`（或雙擊 `install-extension.bat`）。
2. **一鍵卸載**：在 PowerShell 執行 `.\uninstall-extension.ps1`（或雙擊 `uninstall-extension.bat`）。
3. **重載生效**：於目標 IDE 按 `Ctrl + Shift + P` -> 執行 `Developer: Reload Window`。
4. **開啟面板**：
   - 點擊左側活動列的 **🛠️ (Antigravity 控制中心)** 圖示。
   - 或點擊右下角狀態列 **`$(tools) 控制中心`** 按鈕。

> 🔀 **類別切換鈕（面板頂部）**：`Antigravity / Cursor / Copilot / Cline` 彩色膠囊鈕（樣式對齊 inspector 的快照來源 chips，各類別一色），讓你**在同一個 IDE 內切換要檢視哪一套資料**——路徑卡片、對話記憶庫統計與卡片文案都會跟著換。
> - 未手動指定（預設）＝依目前宿主 IDE 判定，行為與舊版完全相同；作用中的類別以該類別的顏色高亮。
> - 手動指定會寫入 `antigravity.uiFlavor` 並記憶；即使人在 VS Code，也能直接查看 Cursor、Antigravity 或 Cline 的資料。
> - 點一下「目前宿主」的類別＝回復跟隨宿主（等同 `auto`），因此不再需要「自動」鈕。
> - 本機沒有資料的類別會自動隱藏；可用類別少於兩個時整列切換鈕隱藏。
> - **Cline 只能手動選擇**：Cline 是安裝在 IDE 內的外掛，沒有自己的宿主，所以 `auto` 永遠不會判定成 Cline。

> 💡 **環境感應**：在 Cursor 會顯示 Cursor 本機路徑（`~/.cursor`、agent-transcripts）；在 Antigravity 則顯示 `~/.gemini`；在 VS Code 偵測到 GitHub Copilot 時顯示 Copilot 專屬路徑與 `chatSessions` 對話紀錄（可用上方切換鈕覆寫）。

### 卡片顯示決策

「全域自訂」與「對話記憶庫」兩張卡片會依環境自動切換內容，決策優先序如下：

| 順位 | 環境 | 顯示內容 |
| :--- | :--- | :--- |
| 1 | Cursor | `~/.cursor`、`agent-transcripts` |
| 2 | Antigravity IDE | `~/.gemini`、`brain` |
| 3 | VS Code ＋ 手動開啟 `showAntigravityModulesInVsCode` 且有 Antigravity | `~/.gemini`、`brain` |
| 4 | VS Code ＋ 偵測到 GitHub Copilot | Copilot 路徑、`chatSessions` |
| 5 | 其他 | 兩張卡片自動隱藏 |

手動切換（`antigravity.uiFlavor`）時改為固定顯示該類別，不受上表限制。Cline 類別的路徑對照：

| 卡片按鈕 | Cline 路徑 |
| :--- | :--- |
| Config 根目錄 | `~/.cline` |
| `cline_mcp_settings.json` | `~/.cline/data/settings/cline_mcp_settings.json`（舊版退回 `<IDE User>/globalStorage/saoudrizwan.claude-dev/settings`） |
| Skills / Rules / Plugins | `~/.cline/{skills,rules,plugins}`；不存在時退回 `~/Documents/Cline/{Rules,Plugins}`、`~/.agents/skills` |
| AppData 核心 | `~/.cline/data` |
| 對話記憶庫 | `~/.cline/data/sessions`（不存在時退回舊版 `.../saoudrizwan.claude-dev/tasks`） |

> ⚠️ 清理 Cline 對話只刪除 `~/.cline/data/sessions/<sessionId>/` 資料夾，**不會**同步 `~/.cline/data/db/`（`sessions.db`／`session-search.db` 等 SQLite 索引）；清理後 Cline 介面可能仍列出已刪除的對話，確認視窗會提醒這件事。

相關設定：

| 設定鍵 | 預設 | 說明 |
| :--- | :--- | :--- |
| `antigravity.showAntigravityModulesInVsCode` | `false` | 在 VS Code 顯示 Antigravity 專屬卡片；優先於 Copilot 卡片 |
| `antigravity.showCopilotModulesInVsCode` | `true` | 在 VS Code 偵測到 Copilot 時顯示對應卡片；設為 `false` 可隱藏 |

## 🗂️ 模組結構

```
extension.js                        擴充套件進入點（Webview 訊息路由、命令註冊、事件監聽）
services/
  systemService.js                  IDE 偵測、全域路徑對照、環境特徵、檔案總管過濾
  workspaceService.js               多專案工作區分析與同名修正
  scriptService.js                  專案腳本執行器
  brainService.js                   對話記憶庫分派層（依環境轉派 Cursor / Antigravity / Copilot）
  copilotChatService.js             Copilot Chat 對話紀錄統計與清理（含索引同步）
  skillSyncService.js               全域 Skills 連結同步
lib/
  chat-session-index.js             VS Code 對話索引（state.vscdb）外部讀寫
  skill-junction-sync.js            Windows Junction 零複製連結
media/
  app.js / index.html / style.css   側邊欄 Webview 介面
  locales.js                        多國語言字典（zh-TW / en，兩邊鍵必須對稱）
```
