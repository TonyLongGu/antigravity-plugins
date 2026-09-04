const vscode = require('vscode');
const quotaService = require('./services/quotaService');
const fs = require('fs');
const path = require('path');
const os = require('os');
const I18n = require('./i18n');

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
let i18n = null;

// Sentinel 檔案路徑（由全域 hooks.json Stop Hook 寫入）
const SENTINEL_FILE = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'quota-refresh.trigger');

/**
 * 插件啟動進入點
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  extContext = context;
  i18n = new I18n(context.extensionUri);

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
  statusBarItem.text = `${STATUS_ICON} ${i18n.t('status_checking')}`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 2. 註冊命令
  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.refresh', async () => {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.text = `${STATUS_ICON} ${i18n.t('status_refreshing')}`;
      await updateStatusBar(true);
      vscode.window.setStatusBarMessage(i18n.t('toast_refreshed'), 2500);
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

  // 5. 監聽使用者設定變更與全域語言變更 (即時聯動)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiQuota')) {
        setupTimer();
        updateStatusBar(false);
      }
      if (e.affectsConfiguration('antigravity.locale')) {
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
 * 格式化重置倒數時間 (支援多國語言)
 * @param {string|null} resetTimeIso
 * @param {boolean} isUnlimited
 * @param {string} [fallbackText]
 * @returns {string}
 */
function formatResetTime(resetTimeIso, isUnlimited = false, fallbackText = null) {
  if (isUnlimited) return i18n.t('unlimited');
  if (!resetTimeIso) return fallbackText || i18n.t('plenty');

  try {
    const targetTime = new Date(resetTimeIso).getTime();
    if (isNaN(targetTime)) {
      return fallbackText || i18n.t('plenty');
    }
    const now = Date.now();
    const diffMs = targetTime - now;

    if (diffMs <= 0) {
      return i18n.t('resets_soon');
    }

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return i18n.t('resets_in_days_hours', { days, hours });
    } else if (hours > 0) {
      return i18n.t('resets_in_hours_minutes', { hours, minutes });
    } else {
      return i18n.t('resets_in_minutes', { minutes });
    }
  } catch (_) {
    return i18n.t('calculating');
  }
}

/**
 * 格式化預算或偏差值顯示文字 (支援多國語言)
 * @param {Object} item
 * @param {number} percent
 * @returns {string}
 */
function formatCalculatedText(item, percent) {
  if (percent === UNLIMITED) return i18n.t('unlimited');
  if (!item) return i18n.t('calculating');
  if (item.isUnlimited) return i18n.t('unlimited');
  if (item.displayText) {
    if (item.displayText === '無限制') return i18n.t('unlimited');
    if (item.displayText === '計算中') return i18n.t('calculating');
    return item.displayText;
  }
  return i18n.t('calculating');
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
    md.appendMarkdown(i18n.t('tooltip_title'));

    const gWkRefresh = formatResetTime(data?.gemini?.weekly?.resetTime, gWk === UNLIMITED, i18n.t('unlimited'));
    const g5hRefresh = formatResetTime(data?.gemini?.fiveHour?.resetTime, g5h === UNLIMITED, i18n.t('plenty'));
    const gDaily = formatCalculatedText(data?.gemini?.weekly?.dailyBudget, gWk);
    const gDev = formatCalculatedText(data?.gemini?.weekly?.deviation, gWk);

    const cWkRefresh = formatResetTime(data?.claude?.weekly?.resetTime, cWk === UNLIMITED, i18n.t('plenty'));
    const c5hRefresh = formatResetTime(data?.claude?.fiveHour?.resetTime, c5h === UNLIMITED, i18n.t('unlimited'));
    const cDaily = formatCalculatedText(data?.claude?.weekly?.dailyBudget, cWk);
    const cDev = formatCalculatedText(data?.claude?.weekly?.deviation, cWk);

    md.appendMarkdown(i18n.t('tooltip_gemini_header'));
    md.appendMarkdown(i18n.t('tooltip_weekly_limit', { value: fmtPct(gWk), refresh: gWkRefresh }));
    md.appendMarkdown(i18n.t('tooltip_five_hour_limit', { value: fmtPct(g5h), refresh: g5hRefresh }));
    md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: gDaily }));
    md.appendMarkdown(i18n.t('tooltip_deviation', { value: gDev }));

    md.appendMarkdown(i18n.t('tooltip_claude_header'));
    md.appendMarkdown(i18n.t('tooltip_weekly_limit', { value: fmtPct(cWk), refresh: cWkRefresh }));
    md.appendMarkdown(i18n.t('tooltip_five_hour_limit', { value: fmtPct(c5h), refresh: c5hRefresh }));
    md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: cDaily }));
    md.appendMarkdown(i18n.t('tooltip_deviation', { value: cDev }));

    md.appendMarkdown(`---\n`);
    const updatedTime = new Date().toLocaleTimeString(i18n.getLocale() === 'en' ? 'en-US' : 'zh-TW', { hour12: false });
    md.appendMarkdown(i18n.t('tooltip_last_updated', { time: updatedTime }));
    md.appendMarkdown(i18n.t('tooltip_click_menu'));

    statusBarItem.tooltip = md;
  } catch (err) {
    statusBarItem.text = `${STATUS_ICON} ${i18n.t('status_error')}`;
    statusBarItem.tooltip = i18n.t('status_error_tooltip', { error: err.message });
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
      label: i18n.t('menu_refresh_label'),
      description: i18n.t('menu_refresh_desc'),
      action: 'refresh'
    },
    {
      label: i18n.t('menu_mode_label'),
      description: i18n.t('menu_mode_desc'),
      action: 'toggleMode'
    },
    {
      label: i18n.t('menu_bg_label'),
      description: i18n.t('menu_bg_desc'),
      action: 'setBackground'
    },
    {
      label: i18n.t('menu_interval_label'),
      description: i18n.t('menu_interval_desc'),
      action: 'setInterval'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: i18n.t('menu_placeholder')
  });

  if (!selected) return;

  switch (selected.action) {
    case 'refresh':
      await updateStatusBar(true);
      vscode.window.setStatusBarMessage(i18n.t('toast_refresh_done'), 2500);
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
    { label: 'default', description: i18n.t('bg_default_desc'), picked: current === 'default' },
    { label: 'warning', description: i18n.t('bg_warning_desc'), picked: current === 'warning' },
    { label: 'error', description: i18n.t('bg_error_desc'), picked: current === 'error' }
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: i18n.t('bg_placeholder')
  });

  if (selected) {
    await config.update('backgroundColor', selected.label, vscode.ConfigurationTarget.Global);
    await updateStatusBar(false);
    vscode.window.setStatusBarMessage(i18n.t('status_bg_updated', { mode: selected.label }), 2500);
  }
}

/**
 * 切換顯示模式
 */
async function promptChangeDisplayMode() {
  const config = vscode.workspace.getConfiguration('aiQuota');
  const current = config.get('displayMode', 'compact');

  const modes = [
    { label: 'compact', description: i18n.t('mode_compact_desc'), picked: current === 'compact' },
    { label: 'standard', description: i18n.t('mode_standard_desc'), picked: current === 'standard' }
  ];

  const selected = await vscode.window.showQuickPick(modes, {
    placeHolder: i18n.t('mode_placeholder')
  });

  if (selected) {
    await config.update('displayMode', selected.label, vscode.ConfigurationTarget.Global);
    await updateStatusBar(false);
    vscode.window.setStatusBarMessage(i18n.t('status_mode_updated', { mode: selected.label }), 2500);
  }
}


/**
 * 設定背景自動檢查間隔分鐘數
 */
async function promptSetRefreshInterval() {
  const config = vscode.workspace.getConfiguration('aiQuota');
  const current = config.get('refreshIntervalMinutes', 5);

  const input = await vscode.window.showInputBox({
    prompt: i18n.t('interval_prompt'),
    value: current.toString(),
    validateInput: (val) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 0) {
        return i18n.t('interval_invalid');
      }
      return null;
    }
  });

  if (input !== undefined) {
    const val = parseInt(input, 10);
    await config.update('refreshIntervalMinutes', val, vscode.ConfigurationTarget.Global);
    setupTimer();
    const msg = val === 0 ? i18n.t('interval_disabled') : i18n.t('interval_updated', { val });
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
