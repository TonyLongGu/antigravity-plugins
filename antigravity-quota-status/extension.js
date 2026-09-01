const vscode = require('vscode');
const quotaService = require('./services/quotaService');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UNLIMITED = -1; // 與 quotaService.js 一致：付費版 Gemini 無限額度
const STATUS_ICON = '$(sparkle)'; // 狀態列前綴圖示，可自由改為 $(flame)、$(zap)、$(sparkle)、$(plug)、$(chip) 等

/** 將百分比數字格式化為顯示文字 */
function fmtPct(pct) {
  return pct === UNLIMITED ? '∞' : `${pct}%`;
}

/** 將偏差值格式化為顯示文字（例如 +3.3% 或 -10.8%） */
function fmtDaily(budget) {
  if (!budget) return '+0.0%';
  if (budget.isUnlimited) return '∞';
  if (budget.usablePercent === null || budget.usablePercent === undefined) return '+0.0%';
  const val = budget.usablePercent;
  return val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`;
}

let extContext = null;
let statusBarItem = null;
let pollTimer = null;
let sentinelWatcher = null;

// Sentinel 檔案路徑（由全域 hooks.json Stop Hook 寫入）
const SENTINEL_FILE = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'quota-refresh.trigger');

/**
 * 插件啟動進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  extContext = context;
  // 1. 建立狀態列項目
  const config = vscode.workspace.getConfiguration('aiQuota');
  const alignment = config.get('alignment', 'right') === 'left'
    ? vscode.StatusBarAlignment.Left
    : vscode.StatusBarAlignment.Right;
  const priority = config.get('priority', 30);

  statusBarItem = vscode.window.createStatusBarItem(alignment, priority);
  statusBarItem.command = 'aiQuota.showMenu';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.color = undefined;
  statusBarItem.text = `${STATUS_ICON} AI 額度: 檢測中...`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 2. 註冊命令
  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.refresh', async () => {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.text = `${STATUS_ICON} AI 額度: 刷新中...`;
      await updateStatusBar(true);
      vscode.window.setStatusBarMessage('已重新整理 AI 模型額度狀態。', 2500);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.showMenu', async () => {
      await showActionMenu();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.toggleDisplayMode', async () => {
      await promptChangeDisplayMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.setBackgroundColor', async () => {
      await promptSetBackgroundColor();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.setRefreshInterval', async () => {
      await promptSetRefreshInterval();
    })
  );

  // 3. 監聽帳號認證與工作階段變更 (切換帳號時自動強制刷新)
  if (vscode.authentication && vscode.authentication.onDidChangeSessions) {
    context.subscriptions.push(
      vscode.authentication.onDidChangeSessions(async () => {
        await updateStatusBar(true);
      })
    );
  }

  // 4. 監聽 IDE 視窗焦點 (切換視窗回來時自動同步)
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async (state) => {
      if (state.focused) {
        await updateStatusBar(false);
      }
    })
  );

  // 5. 監聽使用者設定變更
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiQuota')) {
        setupTimer();
        updateStatusBar(false);
      }
    })
  );

  // 6. 初次載入與背景定時輪詢
  updateStatusBar(true);
  setupTimer();

  // 7. 監聽 Stop Hook 寫入的 sentinel 觸發檔（對話結束 → 立即刷新）
  setupSentinelWatcher(context);
}

/**
 * 監聽 Stop Hook 觸發的 sentinel 檔案
 * 每次 AI 對話結束時，hooks.json 的 Stop Hook 會更新此檔，觸發即時刷新
 * @param {vscode.ExtensionContext} context
 */
function setupSentinelWatcher(context) {
  const sentinelDir = path.dirname(SENTINEL_FILE);
  let debounceTimer = null;

  try {
    sentinelWatcher = fs.watch(sentinelDir, (eventType, filename) => {
      if (filename !== path.basename(SENTINEL_FILE)) return;
      if (eventType !== 'rename' && eventType !== 'change') return;

      // 防抖：避免短時間多次觸發（Stop Hook 可能連續寫入）
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await updateStatusBar(true);
      }, 500);
    });

    context.subscriptions.push({
      dispose: () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (sentinelWatcher) {
          sentinelWatcher.close();
          sentinelWatcher = null;
        }
      }
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      // 若目錄不存在則直接返回，捨棄先前的 fs.existsSync 同步檢查
      return;
    }
    // sentinel watcher 失敗不影響主要功能，仍有背景輪詢兜底
    console.warn('[AI 額度] sentinel watcher 初始化失敗:', err.message);
  }
}

/**
 * 更新狀態列文字與 Tooltip
 * @param {boolean} forceRefresh
 */
async function updateStatusBar(forceRefresh = false) {
  if (!statusBarItem) return;

  try {
    const data = await quotaService.getQuotaStatus(forceRefresh);
    const config = vscode.workspace.getConfiguration('aiQuota');
    const displayMode = config.get('displayMode', 'compact');

    const gPri = data?.gemini?.primary?.percent ?? 100;
    const cPri = data?.claude?.primary?.percent ?? 100;
    const g5h = data?.gemini?.fiveHour?.percent ?? 100;
    const gWk = data?.gemini?.weekly?.percent ?? UNLIMITED;
    const c5h = data?.claude?.fiveHour?.percent ?? UNLIMITED;
    const cWk = data?.claude?.weekly?.percent ?? 100;

    const isPaid = data?.account?.isPaidTier;

    let text = '';

    if (displayMode === 'standard') {
      // standard 標準模式：Gemini: 59%, 53% | Claude: 7%, 100%
      if (isPaid || (gWk !== UNLIMITED && g5h !== UNLIMITED)) {
        const gText = (gWk !== UNLIMITED && g5h !== UNLIMITED) ? `${fmtPct(gWk)}, ${fmtPct(g5h)}` : fmtPct(gPri);
        const cText = (cWk !== UNLIMITED && c5h !== UNLIMITED) ? `${fmtPct(cWk)}, ${fmtPct(c5h)}` : fmtPct(cPri);
        text = `Gemini: ${gText} | Claude: ${cText}`;
      } else {
        text = `Gemini: ${fmtPct(gPri)} | Claude: ${fmtPct(cPri)}`;
      }
    } else {
      // compact 極簡雙欄模式 (預設)：59%, 53% | 7%, 100%
      if (isPaid || (gWk !== UNLIMITED && g5h !== UNLIMITED && cWk !== UNLIMITED && c5h !== UNLIMITED)) {
        text = `${fmtPct(gWk)}, ${fmtPct(g5h)} | ${fmtPct(cWk)}, ${fmtPct(c5h)}`;
      } else {
        text = `${fmtPct(gPri)} | ${fmtPct(cPri)}`;
      }
    }

    statusBarItem.text = `${STATUS_ICON} ${text}`;

    // 依據使用者設定配置狀態列底色 (預設 default 無底色)
    const bgMode = config.get('backgroundColor', 'default');
    let bgColor = undefined;
    if (bgMode === 'warning') {
      bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (bgMode === 'error') {
      bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    statusBarItem.backgroundColor = bgColor;
    statusBarItem.color = undefined;

    // 建立純文字 Markdown Tooltip (詳細資訊在懸停時查看)
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown('### AI 模型額度狀態\n\n');

    const gWkRefresh = data?.gemini?.weekly?.refreshText || '無限制';
    const g5hRefresh = data?.gemini?.fiveHour?.refreshText || '額度充足';
    const gDaily = data?.gemini?.weekly?.dailyBudget?.displayText || '無限制';
    const gDev = data?.gemini?.weekly?.deviation?.displayText || '無限制';

    const cWkRefresh = data?.claude?.weekly?.refreshText || '額度充足';
    const c5hRefresh = data?.claude?.fiveHour?.refreshText || '無限制';
    const cDaily = data?.claude?.weekly?.dailyBudget?.displayText || '計算中';
    const cDev = data?.claude?.weekly?.deviation?.displayText || '計算中';

    md.appendMarkdown(`#### Gemini Models\n`);
    md.appendMarkdown(`- Weekly Limit: \`${fmtPct(gWk)}\` (${gWkRefresh})\n`);
    md.appendMarkdown(`- Five Hour Limit: \`${fmtPct(g5h)}\` (${g5hRefresh})\n`);
    md.appendMarkdown(`- 建議今日餘額: \`${gDaily}\`\n`);
    md.appendMarkdown(`- 偏差值: \`${gDev}\`\n\n`);

    md.appendMarkdown(`#### Claude and GPT models\n`);
    md.appendMarkdown(`- Weekly Limit: \`${fmtPct(cWk)}\` (${cWkRefresh})\n`);
    md.appendMarkdown(`- Five Hour Limit: \`${fmtPct(c5h)}\` (${c5hRefresh})\n`);
    md.appendMarkdown(`- 建議今日餘額: \`${cDaily}\`\n`);
    md.appendMarkdown(`- 偏差值: \`${cDev}\`\n\n`);

    md.appendMarkdown(`---\n`);
    md.appendMarkdown(`*最後同步時間: ${data?.lastUpdated || '剛剛'}*\n\n`);
    md.appendMarkdown(`[點擊開啟管理選單](command:aiQuota.showMenu)`);

    statusBarItem.tooltip = md;
  } catch (err) {
    statusBarItem.text = `${STATUS_ICON} [錯誤] 額度讀取失敗`;
    statusBarItem.tooltip = `無法獲取模型額度: ${err.message}`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = undefined;
  }
}

/**
 * 彈出操作選單 (純文字 QuickPick)
 */
async function showActionMenu() {
  const data = await quotaService.getQuotaStatus(false);
  const items = [
    {
      label: '重新整理額度',
      description: '立即向本地服務端查詢最新即時配額',
      action: 'refresh'
    },
    {
      label: '切換顯示格式',
      description: '選擇標準或極簡雙欄格式',
      action: 'toggleMode'
    },
    {
      label: '設定背景顏色',
      description: '選擇狀態列項目底色樣式 (預設無底色、警告黃/橘、危險紅)',
      action: 'setBackground'
    },
    {
      label: '設定背景檢查間隔',
      description: '修改背景自動輪詢分鐘數 (設為 0 關閉)',
      action: 'setInterval'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: '請選擇 AI 模型額度管理操作'
  });

  if (!selected) return;

  switch (selected.action) {
    case 'refresh':
      await updateStatusBar(true);
      vscode.window.setStatusBarMessage('已完成額度重新整理。', 2500);
      break;
    case 'toggleMode':
      await promptChangeDisplayMode();
      break;
    case 'setBackground':
      await promptSetBackgroundColor();
      break;
    case 'setInterval':
      await promptSetRefreshInterval();
      break;
  }
}

/**
 * 設定狀態列背景顏色樣式
 */
async function promptSetBackgroundColor() {
  const config = vscode.workspace.getConfiguration('aiQuota');
  const current = config.get('backgroundColor', 'default');

  const options = [
    { label: 'default', description: '無底色 (與狀態列融為一體，預設)', picked: current === 'default' },
    { label: 'warning', description: '警告色 (黃/橘色背景)', picked: current === 'warning' },
    { label: 'error', description: '錯誤/危險色 (紅色背景)', picked: current === 'error' }
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: '請選擇狀態列背景顏色樣式'
  });

  if (selected) {
    await config.update('backgroundColor', selected.label, vscode.ConfigurationTarget.Global);
    await updateStatusBar(false);
    vscode.window.setStatusBarMessage(`已將狀態列背景顏色設定為: ${selected.label}`, 2500);
  }
}

/**
 * 切換顯示模式
 */
async function promptChangeDisplayMode() {
  const config = vscode.workspace.getConfiguration('aiQuota');
  const current = config.get('displayMode', 'compact');

  const modes = [
    { label: 'compact', description: '極簡雙欄 (例如: 59%, 53% | 7%, 100%，預設)', picked: current === 'compact' },
    { label: 'standard', description: '標準模式 (例如: Gemini: 59%, 53% | Claude: 7%, 100%)', picked: current === 'standard' }
  ];

  const selected = await vscode.window.showQuickPick(modes, {
    placeHolder: '請選擇狀態列顯示模式'
  });

  if (selected) {
    await config.update('displayMode', selected.label, vscode.ConfigurationTarget.Global);
    await updateStatusBar(false);
    vscode.window.setStatusBarMessage(`已將狀態列格式切換為: ${selected.label}`, 2500);
  }
}


/**
 * 設定背景自動檢查間隔分鐘數
 */
async function promptSetRefreshInterval() {
  const config = vscode.workspace.getConfiguration('aiQuota');
  const current = config.get('refreshIntervalMinutes', 5);

  const input = await vscode.window.showInputBox({
    prompt: '請輸入背景自動檢查間隔分鐘數 (設為 0 則關閉自動輪詢)',
    value: current.toString(),
    validateInput: (val) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 0) {
        return '請輸入大於或等於 0 的有效整數';
      }
      return null;
    }
  });

  if (input !== undefined) {
    const val = parseInt(input, 10);
    await config.update('refreshIntervalMinutes', val, vscode.ConfigurationTarget.Global);
    setupTimer();
    const msg = val === 0 ? '已關閉背景自動檢查' : `背景自動檢查間隔已更新為: 每 ${val} 分鐘`;
    vscode.window.setStatusBarMessage(msg, 2500);
  }
}

/**
 * 設置背景定時器
 */
function setupTimer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  const config = vscode.workspace.getConfiguration('aiQuota');
  const intervalMinutes = config.get('refreshIntervalMinutes', 5);

  if (intervalMinutes > 0) {
    pollTimer = setInterval(() => {
      updateStatusBar(false);
    }, intervalMinutes * 60 * 1000);
  }
}

/**
 * 插件停用清理
 */
function deactivate() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (sentinelWatcher) {
    sentinelWatcher.close();
    sentinelWatcher = null;
  }
}

module.exports = {
  activate,
  deactivate
};
