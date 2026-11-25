# antigravity-plugins 驗收標準

> 版本 1.1　凍結日 2026-11-25
> 適用：本 repo 任一交付（6 個擴充套件 ＋ 根目錄安裝／解除安裝腳本）。
> 判定者：秘書。執行者提供證據，不自稱通過。
> 基線：commit `a71e11dd`、Node `v24.18.0`、Windows、PowerShell 5.1。文中「預期輸出」全部以此基線實跑為準；數字要變，只有工單明列契約變更才算。
> 怎麼做這個 repo 的程式、圖譜與反模式：`.agents/skills/antigravity-plugins-maintenance/SKILL.md`。本檔只寫「怎麼判定」。
> 凍結判定：秘書 2026-11-16 逐項實跑核對通過（工單 P-20261116-01），基線數字全部重現。此後本檔要改，一律走工單升版。

---

## 0. 驗收前就該有的東西

缺一項就退回，不進入驗收。

- [ ] 工單：一句話目標、包含什麼、明確不包含什麼、必讀文件。
- [ ] 變更清單：`git diff --stat <base>..<head>` 的每一列，都有一句「為什麼動」。
- [ ] 指令與完整輸出：逐字貼，不是摘要；每個指令附退出碼。
- [ ] 環境四行：`node --version`、`git rev-parse --short=8 HEAD`、`$PSVersionTable.PSVersion.ToString()`、實測宿主與版本（Antigravity／VS Code／Cursor；沒測的寫「未測」）。
- [ ] 對外契約差異清單（若動到 command id、設定鍵、選單、`activationEvents`、外掛版本號）。
- [ ] 判定依據：交付時註明依 `docs/ACCEPTANCE.md` 哪個 commit 判定（`git log -1 --format=%h -- docs/ACCEPTANCE.md`）。
- [ ] 圖譜收尾：改了 `.js`／`.ps1`／`package.json` 要附 `graphify update .` 的節點／邊／社群變化與 `Built from commit`（SKILL.md §5）。

## 1. 意圖符合

- [ ] **1.1 範圍**：`git diff --name-only <base>..<head>` 每一列都能對到工單一句。出現清單外檔案即退回。
      例外：`docs/ACCEPTANCE.md` 本身；`graphify-out/` 是忽略目錄，本來就不該出現在清單。
- [ ] **1.2 行為對得上描述**：工單寫的行為，能在 §2 找到對應的通過項與自動測試案例（檔名＋案例編號）。找不到即退回。
- [ ] **1.3 契約只增不減，且新增有依據**：M10 輸出的 `+` 行逐項出現在工單；沒寫就新增即退回。
- [ ] **1.4 版本號**：有改該外掛程式或 UI 的，`package.json` 的 `version` 必須與 base 不同；沒改的必須相同。判定見 M11。
- [ ] **1.5 對外描述不誇大**：README 支援表只能列 Antigravity／Cursor／VS Code，且與 manifest 一致；不得宣稱未實作的能力（例如 VSCodium）。

## 2. 功能正確（含邊界、失敗、可重複、可復原）

### 2.1 主路徑

- [ ] **2.1.1** 全部 JS 可通過語法檢查：M1 → `SYNTAX_FAIL=0`（86 個檔案）。
- [ ] **2.1.2** 兩組回歸測試全過：M2 → 18 支 `exit=0`（支數以 *.test.js 實算為準）；M3 → `ALL-SUITES-PASSED (4/4)`、`exit=0`。
- [ ] **2.1.3** manifest 契約完整：M4 → `BAD=none`，command 總數 112，且與 §5.0 基線表一致（差異需工單明列）。
- [ ] **2.1.4** 工單描述的操作實測一次：寫明「開哪個面板／點哪個選單／按下後畫面出現什麼」，並指出由哪個自動測試守住。只有描述沒有測試、或只有測試沒有實測紀錄，都退回。

### 2.2 邊界

- [ ] 交付按範圍列出「這條邊界 → 哪個案例」，且該案例在測試輸出中為 `✔`／`PASS`：
      - 工作區重複登記、切換、排序：D1–D5（`workspace-dedupe.test.js`）
      - 拖出即移除、找不到目標不寫檔：R1–R6（`workspace-remove.test.js`）
      - Skills 連結同步與歸屬：S1–S13（`skill-junction-sync.test.js`）、I1–I11（`skill-sync-service.test.js`）
      - 資料類別（flavor）切換：E1–E5（`environment-flavor.test.js`）
      - Kilo／Cline 快照與 MCP：K0–K5、B0–B6、J0–J5
      - 空選取、空清單、連按兩次、目標已消失：對應測試案例或工單指定的重現步驟。
- [ ] 找不到對應案例即退回；「應該不會」不算邊界已驗。

### 2.3 失敗乾淨

- [ ] 會改使用者資料的功能（`.code-workspace`、`state.vscdb`、`~/.agents/skills` 的 junction）必須有「失敗不寫檔／不動目標」案例：R3（找不到不寫檔）、S8（dryRun 只回報）、S11（解除連結不動來源內容）。判定：M2 通過，且輸出含這三個案例。
- [ ] 安裝／解除安裝不以「真的裝一次」判定：M5 → 15 支 `.ps1` 剖析 0 錯、12 支薄殼 `COUNT=12` 且 12 個 `OK`。工單若要求實裝，另附安裝前後 `code --list-extensions` 或 `<IDE>/extensions.json` 的差異。

### 2.4 可重複

- [ ] M13：M1 與 M2 各連跑兩次，兩次的 `SYNTAX_FAIL`、退出碼、案例數完全相同。不同即退回，並附兩次輸出。

### 2.5 可復原

- [ ] 交付寫明「怎麼回到操作前」：備份檔位置（例如 `.toolbox-bak`）或重建步驟，並指出對應測試（R3／S11）。沒有還原說明即退回。
- [ ] 依該步驟實際還原一次：受影響檔案的 `Get-FileHash` 與操作前相同，貼出兩次雜湊。無法還原即退回。

## 3. 不破壞既有

- [ ] **3.1** 既有測試與語法全過：M1–M3（與 §2 同一組，不重複跑）。
- [ ] **3.2 對外 id 不消失**：M10 的 `- "command"` 行為 0；若有，必須在工單明列。設定鍵同理。
- [ ] **3.3 跨外掛耦合完整**：M6 → 9 行全部 `OK`。`scriptRunner.locale` 是設定鍵、不是 command id，必須先過濾再比對。
- [ ] **3.4 三語鍵不缺**：M7 → 4 個 `locales` 目錄 `tw_only=0`、`cn_only=0`、`en_only=0/0`；2 個 webview `same=true`（142／142／142、98／98／98）。
- [ ] **3.5 共用檔影響面**：M5 的薄殼結構 12／12 `OK`。改根目錄腳本不得破壞各外掛薄殼的轉呼叫。
- [ ] **3.6 版控衛生**：M9 → `graphify-out` 追蹤檔數 0；根 `AGENTS.md` 存在且為索引式（9 行、四條索引），規則入口＝AGENTS.md（索引）＋SKILL.md（知識正本）。
- [ ] **3.7 不相關檔案未動**：`git diff --name-only <base>..<head>` 不得出現 `README.md`、`install-all.ps1`、`uninstall-all.ps1`、其他外掛的程式檔，除非工單明列。

## 4. 一致性（UI／命名／文件）

- [ ] **4.1 command id 家族**：M12 → `IDS=112`、`OUT_OF_FAMILY=0`。
- [ ] **4.2 新增 UI 字串三語齊全**：交付列出的每個新 key，在該外掛的 `locales\en.json`、`zh-TW.json`、`zh-CN.json` 都找得到；webview 的 key 在 `media/locales.js` 三個語系各一次。漏一個即退回。
- [ ] **4.3 切換鈕樣式**：M8 → 沒有 `DIFF` 行、`CHIP_PROPS_COMPARED=14`。色值固定 Antigravity `#4ec9b0`、Copilot `#9cdcfe`、Cursor `#ce9178`、Cline `#c586c0`、Kilo `#ffd54f`，順序不變、只在啟用態上色。
- [ ] **4.4 文件入口唯一**：M9 的 `AGENTS.md` 存在但只有索引（≤12 行、含技能索引／先讀圖／收尾更新授權／知識落點四條）；知識本體只在 SKILL.md；`docs/` 不得出現第二份規則文件。
- [ ] **4.5 使用者文件**：`README.md` 支援表 6 列（M12b）；外掛名稱與 `package.json` 的 `name` 對得上（quota-status 例外：資料夾 `antigravity-quota-status`、`name` 是 `ai-quota-status`，README 需標明）。
- [ ] **4.6 標題與行為一致**：命令標題不得承諾做不到的事。判定＝在宿主開啟該選單逐項點一次，行為與標題相符，寫下畫面結果（人判，但要寫到別人能照著看到同一個畫面）。

## 5. 證據可重現

> 本節就是可重跑指令與基線；§2、§3 的 M 編號都指回這裡。

所有指令在 repo 根目錄、PowerShell 5.1、Node `v24.18.0` 執行。基線日期 2026-11-25、HEAD `a71e11dd`。

### 5.0 基線快照

| 外掛資料夾 | `name` | version | commands | 設定鍵 | activationEvents |
| :--- | :--- | :--- | ---: | ---: | ---: |
| antigravity-toolbox | antigravity-toolbox | 1.8.4 | 11 | 6 | 1 |
| antigravity-script-runner | antigravity-script-runner | 1.7.1 | 24 | 3 | 1 |
| antigravity-quick-access | antigravity-quick-access | 1.2.6 | 60 | 0 | 1 |
| antigravity-ai-context-inspector | antigravity-ai-context-inspector | 1.3.2 | 4 | 5 | 0 |
| antigravity-mcp-manager | antigravity-mcp-manager | 1.10.1 | 6 | 0 | 1 |
| antigravity-quota-status | ai-quota-status | 1.2.1 | 7 | 7 | 1 |

其他基線：JS 86 檔、`.ps1` 15 檔、薄殼 12 檔、`*.test.js` 18 檔、command 總數 112。
i18n：`locales` 鍵數 mcp-manager 132、quick-access 47、quota-status 81、script-runner 5；webview 142（toolbox）、98（inspector）。

### M1 語法檢查（86 檔）

```powershell
$bad = 0
Get-ChildItem -Recurse -Filter *.js |
  Where-Object { $_.FullName -notmatch '\\graphify-out\\' } |
  ForEach-Object { node --check $_.FullName 2>$null; if ($LASTEXITCODE) { $bad++ } }
"SYNTAX_FAIL=$bad"
```

預期：`SYNTAX_FAIL=0`。

### M2 全部回歸測試（18 支）

```powershell
$root = (Get-Location).Path
Get-ChildItem -Recurse -Filter *.test.js | Sort-Object FullName | ForEach-Object {
  node $_.FullName *> $null
  "{0} exit={1}" -f $_.FullName.Replace("$root\", ""), $LASTEXITCODE
}
```

預期：行數＝*.test.js 實算數（2026-11-25 為 18），每行 `exit=0`；最後一行是 `antigravity-toolbox\tests\workspace-remove.test.js exit=0`。

### M3 script-runner 四套件

```powershell
node antigravity-script-runner/tests/run-all.js
"EXIT=$LASTEXITCODE"
```

預期：輸出含 `LOCALE-CHECK-PASSED`、`FRONTEND-ALL-ASSERTIONS-PASSED (checked=80, failed=0)`、`BACKEND-ALL-ASSERTIONS-PASSED (checked=63, failed=0)`、`STREAM-ALL-ASSERTIONS-PASSED (checked=13, failed=0)`、`ALL-SUITES-PASSED (4/4)`、`EXIT=0`。

### M4 manifest 契約

```powershell
node -e "const fs=require('fs');const dirs=fs.readdirSync('.').filter(d=>fs.existsSync(d+'/package.json'));let bad=[];for(const d of dirs){const j=JSON.parse(fs.readFileSync(d+'/package.json','utf8'));const cmds=(j.contributes&&j.contributes.commands)||[];const ids=cmds.map(c=>c.command);const dup=ids.filter((v,i)=>ids.indexOf(v)!==i);const menuCmds=[];const walk=o=>{if(!o||typeof o!=='object')return;if(Array.isArray(o))return o.forEach(walk);for(const k in o){if(k==='command'&&typeof o[k]==='string')menuCmds.push(o[k]);else walk(o[k]);}};walk(j.contributes&&j.contributes.menus);const missing=[...new Set(menuCmds)].filter(c=>!ids.includes(c));const keys=Object.keys((j.contributes&&j.contributes.configuration&&j.contributes.configuration.properties)||{});console.log([d,j.name,j.version,'cmds='+ids.length,'dup='+dup.length,'menuMissing='+missing.length,'cfg='+keys.length,'act='+((j.activationEvents||[]).length)].join(' '));if(dup.length||missing.length)bad.push(d);}console.log('BAD='+(bad.join(',')||'none'))"
```

預期：6 列，`dup=0`、`menuMissing=0`；末行 `BAD=none`；各列數字與 §5.0 相同。

### M5 `.ps1` 剖析與薄殼結構

```powershell
$errCount = 0
Get-ChildItem -Recurse -Filter *.ps1 | ForEach-Object {
  $err = $null; $tok = $null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tok, [ref]$err) | Out-Null
  if ($err.Count) { $errCount++; "PARSE_FAIL $($_.Name): $($err[0].Message)" }
}
"PS1_PARSE_FAIL=$errCount"

$shells = Get-ChildItem -Recurse -Filter *-extension.ps1
"COUNT=$($shells.Count)"
$shells | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  if ($c -match '-Plugin \$pluginName' -and $c -notmatch '\bfunction\b') { "OK $($_.Name)" } else { "FAIL $($_.Name)" }
}
```

預期：`PS1_PARSE_FAIL=0`、`COUNT=12`、12 個 `OK`。

### M6 跨外掛 command id

```powershell
node -e "const fs=require('fs');const get=d=>JSON.parse(fs.readFileSync(d+'/package.json','utf8'));const qa=fs.readFileSync('antigravity-quick-access/extension.js','utf8');const ids=[...new Set([...qa.matchAll(/'((?:scriptRunner|antigravity\.toolbox)\.[A-Za-z0-9]+)'/g)].map(m=>m[1]))].filter(x=>x!=='scriptRunner.locale');const sr=get('antigravity-script-runner').contributes.commands.map(c=>c.command);const tb=get('antigravity-toolbox').contributes.commands.map(c=>c.command);for(const id of ids){const arr=id.startsWith('scriptRunner.')?sr:tb;console.log((arr.includes(id)?'OK  ':'MISS')+' '+id)}console.log('COUNT='+ids.length)"
```

預期：`COUNT=9`，且 9 行全部以 `OK` 開頭。

### M7 i18n 鍵對稱

```powershell
node -e "const fs=require('fs');for(const d of fs.readdirSync('.')){const p=d+'/locales';if(!fs.existsSync(p))continue;const g=f=>JSON.parse(fs.readFileSync(p+'/'+f,'utf8'));const en=g('en.json'),tw=g('zh-TW.json'),cn=g('zh-CN.json');const flat=(o,pre='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,pre+k+'.'):[pre+k]);const a=flat(en),b=flat(tw),c=flat(cn);const only=(x,y)=>x.filter(k=>!y.includes(k));console.log(d,'en='+a.length,'tw_only='+only(b,a).length,'cn_only='+only(c,a).length,'en_only='+only(a,b).length+'/'+only(a,c).length)}"

node -e "const fs=require('fs'),vm=require('vm');for(const f of ['antigravity-toolbox/media/locales.js','antigravity-ai-context-inspector/media/locales.js']){const ctx={window:{},globalThis:null};ctx.globalThis=ctx;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(f,'utf8'),ctx);const L=ctx.LOCALES;const ks=Object.keys(L);const lens=ks.map(k=>Object.keys(L[k]).length);const sets=ks.map(k=>Object.keys(L[k]).sort().join('|'));console.log(f,'locales='+ks.join(','),'keys='+lens.join('/'),'same='+(new Set(sets).size===1))}"
```

預期：4 列 `tw_only=0 cn_only=0 en_only=0/0`；2 列 `same=true`（`142/142/142`、`98/98/98`）。

### M8 切換鈕樣式對齊

```powershell
node -e "const fs=require('fs');const get=(f,sel)=>{const s=fs.readFileSync(f,'utf8');const i=s.indexOf(sel+' {');const b=s.slice(i, s.indexOf('}',i));return Object.fromEntries(b.split('\n').slice(1).map(l=>l.trim()).filter(l=>l&&l.includes(':')&&!l.startsWith('/*')).map(l=>{const k=l.slice(0,l.indexOf(':'));const v=l.slice(l.indexOf(':')+1).replace(/;$/,'').trim();return [k,v]}))};const a=get('antigravity-toolbox/media/style.css','.flavor-chip'),b=get('antigravity-ai-context-inspector/media/style.css','.source-chip');const keys=['flex','height','padding','display','align-items','gap','font-family','font-size','font-weight','line-height','color','background','border','border-radius'];for(const k of keys){if(a[k]!==b[k])console.log('DIFF '+k+' toolbox='+a[k]+' inspector='+b[k])}console.log('CHIP_PROPS_COMPARED='+keys.length+' DIFFS_DONE')"
```

預期：`CHIP_PROPS_COMPARED=14 DIFFS_DONE`，且沒有 `DIFF` 行。

### M9 版控衛生

```powershell
(git ls-files graphify-out | Measure-Object).Count
Test-Path AGENTS.md
(Get-Content AGENTS.md -Encoding UTF8).Count
(Select-String -Path AGENTS.md -Pattern '技能索引|先讀圖|收尾更新|知識落點' | Measure-Object).Count
```

預期：`0`、`True`、`9`（≤12）、`4`。

### M10 對外契約增刪（base..head）

```powershell
git diff <base>..<head> -- '*package.json' | Select-String '^[-+]\s+"command"'
```

預期：`+` 行逐項對到工單；`-` 行為 0（除非工單明列移除）。

### M11 版本號變動

```powershell
git diff <base>..<head> --stat -- '*/package.json'
git diff <base>..<head> -- '*/package.json' | Select-String '^[-+]\s+"version"'
```

預期：有程式或 UI 改動的外掛各出現一組 `-`／`+` version；沒改動的外掛不出現 version 行。

### M12 id 家族與 README 支援表

```powershell
node -e "const fs=require('fs');const P={'antigravity-toolbox':'antigravity.toolbox.','antigravity-mcp-manager':'antigravity.mcp.','antigravity-ai-context-inspector':'antigravity.aiContext.','antigravity-quick-access':'antigravity.quickAccess.','antigravity-quota-status':'aiQuota.','antigravity-script-runner':'scriptRunner.'};let n=0,bad=[];for(const d in P){const j=JSON.parse(fs.readFileSync(d+'/package.json','utf8'));for(const c of (j.contributes.commands||[])){n++;if(!c.command.startsWith(P[d]))bad.push(d+':'+c.command)}}console.log('IDS='+n);console.log('OUT_OF_FAMILY='+bad.length);bad.slice(0,10).forEach(x=>console.log('  '+x))"

(Select-String -Path README.md -Pattern '^\|.*\| `antigravity-').Count
```

預期：`IDS=112`、`OUT_OF_FAMILY=0`；README 計數 `6`。

### M13 重複性

再跑一次 M1 與 M2。預期與第一次逐字相同（`SYNTAX_FAIL=0`、行數＝*.test.js 實算數，2026-11-25 為 18，每行 `exit=0`）。

## 6. 界線與流程

- [ ] 驗收者只驗不修：發現問題寫成退回清單，不改程式、不改測試期望值。
- [ ] 判定由秘書做；執行者不自稱通過；需要第二意見由秘書安排。
- [ ] 同一項目退回 2 次即升級給 TonyLongGu。
- [ ] 每次驗收留一筆：HEAD、日期、結論、理由、證據位置（房間訊息或 commit）。
- [ ] 本文件凍結後由秘書管理；執行者不得自行增減條目或放寬預期值，要改走工單並重新凍結。
- [ ] 不為了通過而改契約值（測試期望、command 計數、i18n 鍵數）。改契約＝工單明列。
- [ ] 驗收環境與交付環境不同時，以驗收環境重跑為準；不能重跑的項目記「未驗證」，不算通過。

## 7. 通過／退回怎麼寫

**通過**：一句結論＋證據位置＋已知限制。

> 通過。HEAD `xxxxxxx`。M1 `SYNTAX_FAIL=0`（86 檔）、M2 18/18 `exit=0`、M3 `ALL-SUITES-PASSED (4/4)`、M4 `BAD=none`（112 個 command）、M6 9/9 `OK`、M10 無刪除。已知限制：只在 Antigravity 實測，Cursor 未測。

**退回**：一句結論＋問題清單；每項寫最小重現步驟、期望與實際、對應條號。

> 退回。① §3.4：`zh-CN.json` 缺 `panel_title`（重現：M7 → `cn_only=1`；期望 `cn_only=0`）。② §2.3：R3 應不寫檔，實際寫入 `.code-workspace`（重現：`node antigravity-toolbox/tests/workspace-remove.test.js`，R3 為 `✘`；期望 `✔`）。

**有條件通過**（僅秘書可用）：未過項目屬環境限制且不影響主路徑時使用；列出待補項目與期限，其餘照通過寫法。

---

## 8. 凍結變更記錄

| 日期 | 版本 | 變更 |
| :--- | :--- | :--- |
| 2026-11-25 | v1.1（同版勘誤） | §7 通過範例與 M13 預期對齊 v1.1 基線（86 檔、M2 18 支）；判定邏輯與門檻未變 |
| 2026-11-25 | v1.0 → v1.1 | 依 2026-11-25 實測重算基線（JS 檔數、測試支數、inspector 1.3.2、quota-status 1.2.1、toolbox 1.8.4、quota locales 81）；根 AGENTS.md 由「不存在」改為「存在且為索引式」（§3.6、§4.4、M9）。判定邏輯與門檻未變 |
