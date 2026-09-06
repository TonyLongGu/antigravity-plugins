# 腳本右鍵執行工具 (Antigravity Script Runner)

為 **Google Antigravity IDE** 提供在左側檔案總管、編輯器或分頁標籤按右鍵直接在內建終端機執行腳本的原生擴充套件。

---

## 支援格式與功能

1. **Python 腳本 (`.py`)**
   - 右鍵選單 / 編輯器右上角 ▶ 按鈕：**執行 Python 腳本**
   - 自動儲存未存檔內容，於專屬 PowerShell 終端機調用 `py -u` 執行。

2. **批次檔 (`.bat` / `.cmd`)**
   - 右鍵選單（上方）：**執行批次檔**（一般使用者身分直接在內建整合終端機中執行）
   - 右鍵選單（下方）：**執行批次檔 (系統管理員)**（彈出 Windows UAC 提權並於獨立視窗安全執行）
   - 編輯器右上角 ▶ 按鈕：預設快速以一般身分執行。

3. **PowerShell 腳本 (`.ps1`)**
   - 右鍵選單（上方）：**執行 PowerShell 腳本**（一般身分自動附加 `-ExecutionPolicy Bypass` 於內建終端機執行）
   - 右鍵選單（下方）：**執行 PowerShell 腳本 (系統管理員)**（彈出 Windows UAC 提權並於獨立視窗安全執行）
   - 編輯器右上角 ▶ 按鈕：預設快速以一般身分執行。

4. **資料夾圖片檢視工具 (Image Viewer)**
   - **右鍵選單**：在左側檔案總管任意資料夾按右鍵，選擇 **「檢視圖片」**。
   - **內容區獨立視窗**：於編輯器內容區以分頁開啟專屬工具面板，完整載入資料夾內的圖片（支援 `.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.svg`、`.bmp`、`.ico`、`.avif`、`.tiff` 等）。
   - **畫廊功能**：
      - **壓住右鍵拖曳滾動**：在圖片列表任意處按住滑鼠右鍵拖曳（支援 4.5x 高速抓手手勢），向上推即可快速往後翻閱瀏覽，流暢俐落無需特地瞄準滾動條。
     - 縮圖尺寸滑桿（110px ~ 360px 即時響應式切換）。
     - 即時檔名搜尋與高亮篩選。
     - 多維度排序（檔名自然排序、檔案大小、修改時間）。
     - 支援一鍵切換「包含子資料夾」遞迴檢視。
   - **高精度大圖檢視器 (Lightbox)**：
     - 點擊任一縮圖進入全視窗檢視。
     - **滑鼠滾輪縮放**：以滑鼠游標為精準錨點（Cursor-Anchored Zoom），平滑縮放游標所指之細節。
     - **滑鼠左鍵拖曳**：按住滑鼠左鍵自由平移拖曳（Pan），支援全域指針鎖定（Pointer Capture）防出界脫手。
     - **雙擊畫布**：在「最適視窗大小 (Fit)」與「1:1 原始解析度」之間切換。
     - **快捷鍵支援**：`←` / `→` 切換上一張/下一張、`R` 順時針旋轉 90°、`+` / `-` 縮放、`Esc` 退出。

---

## 擴充套件設定 (Settings)

您可在 IDE 設定（`settings.json`）中微調以下選項：

| 設定項目 | 類型 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `scriptRunner.runAsAdmin` | `boolean` | `true` | **是否預設以系統管理員身分 (Administrator) 執行腳本**。<br>• `true`：彈出 Windows UAC 確認並在提權獨立視窗執行。<br>• `false`：直接在 IDE 內部的整合終端機執行。 |
| `scriptRunner.keepWindowOpen` | `boolean` | `true` | **以管理員執行時，是否在執行完畢後保持視窗開啟**（防止報錯或執行完瞬間閃退，便於檢視輸出）。 |

---

## 安裝與卸載方式

- **一鍵安裝**：在 PowerShell 執行 `.\install-extension.ps1`（或雙擊 `install-extension.bat`）。
- **一鍵卸載**：在 PowerShell 執行 `.\uninstall-extension.ps1`（或雙擊 `uninstall-extension.bat`）。
- **重載生效**：於 IDE 按 `Ctrl + Shift + P` -> 選擇 `Developer: Reload Window`。

