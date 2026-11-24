# AI 模型額度狀態監控擴充套件 (AI Quota Status Extension)

極致簡約狀態列常駐擴充套件，依目前 IDE **自動切換資料源**：

- **Antigravity**：優先讀 IDE 自己的本機語言伺服器（`agy.exe`，透過 `~/.gemini/antigravity/daemon/hub_*.json` 取得 port／csrf 後呼叫 `RetrieveUserQuotaSummary`），與 IDE 配額面板同源，Gemini 與 Claude+GPT 都有真實數字；取不到才退回 Google Cloud Code API（`~/.gemini/antigravity-acp` 的 OAuth 憑證，自動續期）。
- **Cursor IDE**：讀取本機登入憑證，查詢雲端 usage API，監控 Auto / API 月結剩餘額度。

全套件採用**純文字排版**，無任何 Emoji 或小圖示，無冗贅前綴，最大化節省狀態列空間，且完全不改變狀態列底色。

---

## 主要功能

1. **極致乾淨狀態列**：
   - **Antigravity compact**：`$(sparkle) 59%, 53% | 7%, 100%`
   - **Cursor compact**：`$(sparkle) 45% | 0%`
   - **標準模式 (`standard`)**：帶模型家族或 Auto / API 標籤
   - **原生無干擾**：搭配 IDE 原生向量圖示與主題色彩，完美融合 IDE 底部狀態列。

2. **懸浮詳細資訊 (Tooltip)**：
   - Antigravity：每週配額、5 小時配額、重置倒數、**建議今日餘額**、**偏差值**
   - Cursor：帳單週期、Auto / API 剩餘、方案內含美金用量、建議今日餘額、偏差值
   - 精確到日時分的重置倒數與最後檢查時間

3. **點擊管理選單 (QuickPick)**：
   - 重新整理、切換顯示模式、設定背景顏色、自訂檢查頻率
   - Antigravity 可切換監控的 Language Server 帳號
   - Cursor 可開啟 Spending 儀表板

4. **自訂背景色彩支援 (`aiQuota.backgroundColor`)**：
   - `default`：無底色（與狀態列原生融為一體，預設）。
   - `warning`：警告色（黃／橘色背景）。
   - `error`：錯誤／危險色（紅色背景）。

---

## 啟用方式

1. 執行本目錄 `install-extension.ps1`：預設一次安裝到本機所有已偵測的 Antigravity 與 Cursor（VS Code 沒有額度 API，腳本會自動略過）；要只裝單一 IDE 可加 `-Target Antigravity|Cursor`。
2. 按快捷鍵 `Ctrl + Shift + P`。
3. 輸入並執行 `Developer: Reload Window`（重新載入視窗）。
4. 底部狀態列即會顯示極簡純文字 AI 額度狀態。

資料源預設 `aiQuota.backend = auto`，依 IDE 自動選擇。Cursor 路徑使用未公開雲端 API，官方更新後可能失效；權威數字仍以 [Spending dashboard](https://cursor.com/dashboard/spending) 為準。

## 資料來源與失敗行為

- **Antigravity（IDE 開著）**：優先透過 Antigravity 官方擴充套件（`google.antigravity`）匯出的語言伺服器 client 查詢 `RetrieveUserQuotaSummary` 與 `GetUserStatus`，IDE 的伺服器管理員會按需啟動 `agy.exe`；備援是直接讀 `~/.gemini/antigravity/daemon/hub_*.json` 的 `pid`／`httpPort`／`httpsPort`／`csrfToken` 連同一個服務。兩條路都與 IDE 配額面板同源，拿到完全相同的 Gemini／Claude+GPT 群組、方案與帳號。
- **語言伺服器休眠時**：`agy.exe` 會隨 IDE 面板關閉而結束，此時沿用最後一次成功讀到的值，並在 tooltip 標明「顯示 HH:MM 讀到的值」；快照超過 24 小時就視為過期。數字不會退回 100%。
- **Antigravity（IDE 沒開、只用 CLI）**：退回 Google Cloud Code API，使用 `~/.gemini/antigravity-acp/antigravity-oauth-token`（含 `acp_token.json` 的 client 與 refresh token）查詢 `v1internal:retrieveUserQuotaSummary`／`fetchAvailableModels`，權杖過期時自動以 refresh token 換新（只快取在記憶體，不回寫憑證檔）。此路徑對免費層帳號只回 Claude+GPT 群組，Gemini 會顯示「無法取得」而不是假 100%。
- 舊版 IDE 仍保留「掃描本機 language server 進程 → 找監聽埠 → RPC」的退回路徑。
- **取不到資料時不再顯示 100%**：狀態列顯示「AI 額度: 無法取得」，tooltip 說明原因（例如尚未登入、憑證失效），避免把「沒抓到」誤讀成「額度全滿」。
