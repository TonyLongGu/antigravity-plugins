# AI 模型額度狀態監控擴充套件 (AI Quota Status Extension)

極致簡約狀態列常駐擴充套件，依目前 IDE **自動切換資料源**：

- **Google Antigravity IDE**：直連本機 Language Server，監控 Gemini / Claude+GPT 的每週 + 5 小時配額。
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

1. 執行本目錄 `install-extension.ps1`，安裝至 Antigravity 與／或 Cursor。
2. 按快捷鍵 `Ctrl + Shift + P`。
3. 輸入並執行 `Developer: Reload Window`（重新載入視窗）。
4. 底部狀態列即會顯示極簡純文字 AI 額度狀態。

資料源預設 `aiQuota.backend = auto`，依 IDE 自動選擇。Cursor 路徑使用未公開雲端 API，官方更新後可能失效；權威數字仍以 [Spending dashboard](https://cursor.com/dashboard/spending) 為準。
