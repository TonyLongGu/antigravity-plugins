# MCP 管理儀表板 - Antigravity 原生側邊欄擴充套件

專為 **Google Antigravity IDE** 打造的原生側邊欄擴充套件，提供全域 MCP 伺服器開關控制、狀態監控、即時連線測試、獨立 sidecar 備註與設定檔快速編輯。

**僅支援 Antigravity IDE。** 不安裝至 Cursor 或 Visual Studio Code；若本機仍有舊版 Junction，安裝時會一併清除。

---

## 核心特色

1. **Antigravity 原生開關**：讀寫 `~/.gemini/config/mcp_config.json`（`mcpServers`，以 `disabled` 欄位開關）。
2. **外部 Sidecar 註解分離**：`~/.gemini/config/antigravity_mcp_notes.json`
3. **無縫嵌入 IDE 側邊欄**：常駐左側活動列，點擊專屬圖示即可操作。
4. **狀態列即時指示**：底部顯示 `MCP: X/Y`，懸停可看啟用清單。
5. **熱重載**：外部或 AI 修改 MCP 設定檔時，側邊欄自動更新。

---

## 安裝與啟用

1. 雙擊 [`install-extension.bat`](./install-extension.bat)（或執行 [`install-extension.ps1`](./install-extension.ps1)）。
   - 腳本只會部署至本機的 **Antigravity IDE**，並清除 Cursor / VS Code 殘留。
2. 在 Antigravity 按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，執行 `Developer: Reload Window`。
3. 左側活動列出現 **「MCP 伺服器管理」** 即可使用。

---

## 移除與卸載

1. 雙擊 [`uninstall-extension.bat`](./uninstall-extension.bat)（或執行 [`uninstall-extension.ps1`](./uninstall-extension.ps1)）。
2. 在 IDE 執行 `Developer: Reload Window`。
