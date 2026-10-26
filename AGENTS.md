# AGENTS.md — antigravity-plugins

> 常駐層只留**進場指引 ＋ 鐵律**（這個檔每輪都付費）。專案知識、圖譜常數、跨外掛耦合表與作業流程全在技能
> [`.agents/skills/antigravity-plugins-maintenance`](.agents/skills/antigravity-plugins-maintenance/SKILL.md)。
> 若 harness／工作區另有全域規範，**衝突時以全域為準**（安全／授權 ＞ 正確性 ＞ 精簡）。路徑一律相對。

## 動工前 3 步

1. **叫用技能 `antigravity-plugins-maintenance`** —— 六外掛結構、圖譜常數、耦合與邊界都在那。
2. 有 `graphify-out/GRAPH_REPORT.md` 就先讀（純程式架構圖，15.2 KB 可整讀）；`graph.json` 1.9 MB **禁整讀**。
3. 改動前用 `graphify affected "<節點>" --depth 2` 看影響半徑。

## 鐵律（違反會出事）

| 鐵律 | 為什麼 |
| :--- | :--- |
| 安裝／卸載邏輯要**同步改 6 份**（`install-extension.ps1`／`uninstall-extension.ps1`；同名 helper 如 `get-runningideforroot()` 各 14 份） | 六外掛沒有共用模組，改一份只修到一個外掛 |
| 改 command id 前必 grep `scriptRunner.`／`antigravity.toolbox.` | 跨外掛是 `executeCommand('<id>')` 字串耦合，AST 抓不到 |
| 改了 `.js`／`.ps1`／`package.json` ⇒ 收尾**直接** `graphify update .`（本行即授權，不必再問）；只改 `.md`／`.css` ⇒ **不要**跑 | `.graphifyignore` 已排除 `*.md`，md-only 變更屬無害過期 |
| `graphify-out/` 不進版控 | 產物 >1 MB，重建成本低（3 秒、0 元） |

> 本檔刻意不含絕對磁碟路徑，repo 搬移或複製到別台機器後仍有效。
