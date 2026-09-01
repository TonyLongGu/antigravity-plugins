# 腳本右鍵執行工具 (Antigravity Script Runner)

為 **Google Antigravity IDE** 提供在左側檔案總管、編輯器或分頁標籤按右鍵直接在內建終端機執行腳本的原生擴充套件。

---

## 支援格式與功能

1. **Python 腳本 (`.py`)**
   - 右鍵選單 / 編輯器右上角 ▶ 按鈕：**執行 Python 腳本**
   - 自動儲存未存檔內容，於專屬 PowerShell 終端機調用 `py -u` 執行。

2. **批次檔 (`.bat` / `.cmd`)**
   - 右鍵選單 / 編輯器右上角 ▶ 按鈕：**執行批次檔**
   - 自動在下方建立「腳本執行器」PowerShell 終端機，切換至該目錄並安全執行。

3. **PowerShell 腳本 (`.ps1`)**
   - 右鍵選單 / 編輯器右上角 ▶ 按鈕：**執行 PowerShell 腳本**
   - 自動附加 `-ExecutionPolicy Bypass` 權限並在專屬 PowerShell 終端機執行。

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

