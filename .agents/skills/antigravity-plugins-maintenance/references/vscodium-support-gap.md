# 未結案：VSCodium 支援（README 與實作不一致）

> 稽核日期：2026-10-26（`graphify` 0.9.80 建圖 commit `ea192ae6` 之後，純 grep ＋ 人工核對）

## 事實

| 項目 | 實測結果 |
| :--- | :--- |
| 帶 `vscodium` 字樣的安裝腳本 | **7 支**：6 個外掛的 `install-extension.ps1` ＋ 根 `install-all.ps1` |
| 每支的命中次數 | **各 1 次**，且全部落在 `get-runningideforroot()` 的**程序偵測**（判斷「跑的是 VSCodium 還是 VS Code」） |
| 部署目標（`code`／`codium` CLI 路徑、擴充套件安裝目錄） | **0 個**——沒有任何腳本把 `.vsix` 裝進 VSCodium |
| 卸載腳本 | 6 支 `uninstall-extension.ps1` ＋ 根 `uninstall-all.ps1`，同樣**無** VSCodium 分支 |
| 結論 | `README` 敘述的 VSCodium 支援**大於**實作；是文件與程式碼不一致，不是設定問題 |

## 查法（可重跑）

```powershell
Get-ChildItem -Recurse -Filter 'install*.ps1' |
  Select-String -Pattern 'vscodium' -CaseSensitive:$false |
  Group-Object Path | Select-Object Count, Name
```

判準：命中若只出現在 `get-runningideforroot()` 區塊，就是「只偵測、不部署」。

## 待決（二選一，未定案）

| 選項 | 範圍 | 代價 |
| :--- | :--- | :--- |
| **① 只修文件** | `README.md` 改寫成「僅 VS Code 支援，VSCodium 需自行側載 `.vsix`」 | 1 檔；不動程式 |
| **② 補實作** | 6 支 `install-extension.ps1` ＋ 6 支 `uninstall-extension.ps1` ＋ 根 `install-all.ps1`／`uninstall-all.ps1` 全加 `codium` 分支 | 13 檔；依 §6 同名 helper 各 14 份，**必須同步**；改完依 §5 跑 `graphify update .` |

選 ② 前的必做：`graphify affected "get-runningideforroot" --depth 2` 先看影響半徑（實測 17 個節點）。
