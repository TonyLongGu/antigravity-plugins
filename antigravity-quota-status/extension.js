const vscode = require('vscode');
const quotaService = require('./services/quotaService');
const fs = require('fs');
const path = require('path');
const os = require('os');
const I18n = require('./i18n');

const UNLIMITED = -1; // -1 代表無限制或尚未初始化標記
const STATUS_ICON = '$(sparkle)'; // 狀態列前綴圖示，可自由改為 $(flame)、$(zap)、$(sparkle)、$(plug)、$(chip) 等
const CURSOR_DASHBOARD_URL = 'https://cursor.com/dashboard/spending';

/** 將百分比數字格式化為顯示文字 */
function fmtPct(pct) {
  if (pct === null || pct === undefined) return '--';
  return pct === UNLIMITED ? '∞' : `${pct}%`;
}

/** 將美分金額格式化為美元文字 */
function fmtUsdCents(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '--';
  return `$${(cents / 100).toFixed(2)}`;
}

/** 將 ISO 日期格式化為 YYYY-MM-DD */
function fmtDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  statusBarItem.backgroundColor = undefined;
  statusBarItem.color = undefined;
  statusBarItem.text = `${STATUS_ICON} ${i18n.t('status_checking')}`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 2. 註冊命令
  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.refresh', async () => {
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

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.switchAccount', async () => {
      await promptSwitchAccount();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiQuota.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(CURSOR_DASHBOARD_URL));
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
  context.subscriptions.push({
    dispose: () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  });

  // 7. Antigravity：監聽 Stop Hook 寫入的 sentinel 觸發檔（對話結束 → 立即刷新）
  if (quotaService.getBackend() === 'antigravity') {
    setupSentinelWatcher(context);
  }
}

/**
 * 監聽 Stop Hook 觸發的 sentinel 檔案
 * 每次 AI 對話結束時，hooks.json 的 Stop Hook 會更新此檔，觸發即時刷新
 * @param {vscode.ExtensionContext} context
 */
function setupSentinelWatcher(context) {
  let debounceTimer = null;

  try {
    const sentinelDir = path.dirname(SENTINEL_FILE);
    if (!fs.existsSync(sentinelDir)) {
      fs.mkdirSync(sentinelDir, { recursive: true });
    }
    if (!fs.existsSync(SENTINEL_FILE)) {
      fs.writeFileSync(SENTINEL_FILE, '', { flag: 'a' });
    }

    // 直接精確監聽 sentinel 檔案本身，杜絕父目錄中高頻 brain/transcripts I/O 干擾
    sentinelWatcher = fs.watch(SENTINEL_FILE, (eventType) => {
      if (eventType !== 'rename' && eventType !== 'change') return;

      // 防抖：避免短時間多次觸發（Stop Hook 可能連續寫入）
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await updateStatusBar(true);
      }, 500);
    });

    sentinelWatcher.on('error', (err) => {
      console.warn('[AI 額度] sentinel watcher 錯誤:', err.message);
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

function applyBackground(config) {
  const bgMode = config.get('backgroundColor', 'default');
  let bgColor = undefined;
  if (bgMode === 'warning') {
    bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (bgMode === 'error') {
    bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  statusBarItem.backgroundColor = bgColor;
  statusBarItem.color = undefined;
}

function appendFooter(md) {
  md.appendMarkdown(`---\n`);
  const updatedTime = new Date().toLocaleTimeString(i18n.getLocale() === 'en' ? 'en-US' : 'zh-TW', { hour12: false });
  md.appendMarkdown(i18n.t('tooltip_last_updated', { time: updatedTime }));
  md.appendMarkdown(i18n.t('tooltip_click_menu'));
}

function renderCursorStatus(data, displayMode) {
  if (!data?.success) {
    statusBarItem.text = `${STATUS_ICON} ${data?.note || i18n.t('status_checking')}`;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(i18n.t('tooltip_title'));
    md.appendMarkdown(i18n.t('status_error_tooltip', { error: data?.note || i18n.t('checking') }));
    md.appendMarkdown('\n\n');
    appendFooter(md);
    md.appendMarkdown(i18n.t('tooltip_unofficial'));
    statusBarItem.tooltip = md;
    return;
  }

  const autoHas = !!(data?.auto?.exists && data.auto.percent !== null && data.auto.percent !== undefined);
  const apiHas = !!(data?.api?.exists && data.api.percent !== null && data.api.percent !== undefined);
  const reqHas = !!(data?.requests?.exists);
  const autoPct = autoHas ? data.auto.percent : null;
  const apiPct = apiHas ? data.api.percent : null;

  let text = '';
  if (reqHas && data.billingModel === 'request_count') {
    const used = data.requests.used;
    const max = data.requests.max;
    text = displayMode === 'standard' ? `Requests: ${used}/${max}` : `${used}/${max}`;
  } else if (autoHas || apiHas) {
    const autoText = fmtPct(autoHas ? autoPct : null);
    const apiText = fmtPct(apiHas ? apiPct : null);
    if (displayMode === 'standard') {
      if (autoHas && apiHas) text = `Auto: ${autoText} | API: ${apiText}`;
      else if (autoHas) text = `Auto: ${autoText}`;
      else text = `API: ${apiText}`;
    } else if (autoHas && apiHas) {
      text = `${autoText} | ${apiText}`;
    } else {
      text = autoHas ? autoText : apiText;
    }
  } else if (data?.included?.limitCents) {
    text = `${fmtUsdCents(data.included.remainingCents)} / ${fmtUsdCents(data.included.limitCents)}`;
  } else {
    text = data?.note || i18n.t('checking');
  }

  statusBarItem.text = `${STATUS_ICON} ${text}`;

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(i18n.t('tooltip_title'));
  md.appendMarkdown(i18n.t('tooltip_plan', { plan: data?.account?.tier || 'Cursor' }));
  if (data?.account?.email && data.account.email !== '連線中...') {
    md.appendMarkdown(i18n.t('tooltip_account', { email: data.account.email }));
  }
  md.appendMarkdown(i18n.t('tooltip_cycle', {
    start: fmtDate(data?.billing?.cycleStart),
    end: fmtDate(data?.billing?.cycleEnd)
  }));
  if (data?.included?.limitCents != null) {
    md.appendMarkdown(i18n.t('tooltip_included', {
      used: fmtUsdCents(data.included.usedCents),
      limit: fmtUsdCents(data.included.limitCents)
    }));
    md.appendMarkdown(i18n.t('tooltip_remaining_dollars', {
      value: fmtUsdCents(data.included.remainingCents)
    }));
  }
  if (data?.bonus?.spendCents) {
    md.appendMarkdown(i18n.t('tooltip_bonus', { value: fmtUsdCents(data.bonus.spendCents) }));
  }
  if (data?.messages?.display) {
    md.appendMarkdown(i18n.t('tooltip_message', { message: data.messages.display }));
  }
  if (data?.account?.pendingCancellationDate) {
    md.appendMarkdown(i18n.t('tooltip_cancel', { date: fmtDate(data.account.pendingCancellationDate) }));
  }
  md.appendMarkdown('\n');

  if (reqHas && data.billingModel === 'request_count') {
    const refresh = formatResetTime(data.requests.resetTime, false, i18n.t('plenty'));
    md.appendMarkdown(i18n.t('tooltip_requests_header'));
    md.appendMarkdown(i18n.t('tooltip_requests', { used: data.requests.used, max: data.requests.max }));
    md.appendMarkdown(i18n.t('tooltip_remaining', { value: fmtPct(data.requests.percent), refresh }));
    md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: formatCalculatedText(data.requests.dailyBudget, data.requests.percent) }));
    md.appendMarkdown(i18n.t('tooltip_deviation', { value: formatCalculatedText(data.requests.deviation, data.requests.percent) }));
  } else {
    if (autoHas) {
      const refresh = formatResetTime(data.auto.resetTime, autoPct === UNLIMITED, i18n.t('plenty'));
      md.appendMarkdown(i18n.t('tooltip_auto_header'));
      md.appendMarkdown(i18n.t('tooltip_remaining', { value: fmtPct(autoPct), refresh }));
      md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: formatCalculatedText(data.auto.dailyBudget, autoPct) }));
      md.appendMarkdown(i18n.t('tooltip_deviation', { value: formatCalculatedText(data.auto.deviation, autoPct) }));
    }
    if (apiHas) {
      const refresh = formatResetTime(data.api.resetTime, apiPct === UNLIMITED, i18n.t('plenty'));
      md.appendMarkdown(i18n.t('tooltip_api_header'));
      md.appendMarkdown(i18n.t('tooltip_remaining', { value: fmtPct(apiPct), refresh }));
      md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: formatCalculatedText(data.api.dailyBudget, apiPct) }));
      md.appendMarkdown(i18n.t('tooltip_deviation', { value: formatCalculatedText(data.api.deviation, apiPct) }));
    }
  }

  appendFooter(md);
  md.appendMarkdown(i18n.t('tooltip_unofficial'));
  statusBarItem.tooltip = md;
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

    applyBackground(config);

    if (data?.source === 'cursor') {
      renderCursorStatus(data, displayMode);
      return;
    }

    const gPri = data?.gemini?.primary?.percent ?? 100;
    const cPri = data?.claude?.primary?.percent ?? 100;
    const gWk = data?.gemini?.weekly?.percent ?? gPri;
    const cWk = data?.claude?.weekly?.percent ?? cPri;

    const g5hObj = data?.gemini?.fiveHour;
    const c5hObj = data?.claude?.fiveHour;
    const gHas5h = !!(g5hObj?.exists && g5hObj.percent !== null && g5hObj.percent !== undefined);
    const cHas5h = !!(c5hObj?.exists && c5hObj.percent !== null && c5hObj.percent !== undefined);
    const g5h = gHas5h ? g5hObj.percent : null;
    const c5h = cHas5h ? c5hObj.percent : null;

    let text = '';

    if (displayMode === 'standard') {
      // standard 標準模式：若無 5h 配額則單欄顯示 Gemini: 33% | Claude: 100%
      const gText = gHas5h ? `${fmtPct(gWk)}, ${fmtPct(g5h)}` : fmtPct(gWk);
      const cText = cHas5h ? `${fmtPct(cWk)}, ${fmtPct(c5h)}` : fmtPct(cWk);
      text = `Gemini: ${gText} | Claude: ${cText}`;
    } else {
      // compact 極簡雙欄模式 (預設)：若有 5h 配額則雙欄，若皆無則單欄 (如 33% | 100%)
      if (gHas5h || cHas5h) {
        const gPart = gHas5h ? `${fmtPct(gWk)}, ${fmtPct(g5h)}` : fmtPct(gWk);
        const cPart = cHas5h ? `${fmtPct(cWk)}, ${fmtPct(c5h)}` : fmtPct(cWk);
        text = `${gPart} | ${cPart}`;
      } else {
        text = `${fmtPct(gWk)} | ${fmtPct(cWk)}`;
      }
    }

    statusBarItem.text = `${STATUS_ICON} ${text}`;

    // 建立純文字 Markdown Tooltip (詳細資訊在懸停時查看)
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(i18n.t('tooltip_title'));

    const gWkRefresh = formatResetTime(data?.gemini?.weekly?.resetTime, gWk === UNLIMITED, i18n.t('plenty'));
    const g5hRefresh = gHas5h ? formatResetTime(data?.gemini?.fiveHour?.resetTime, g5h === UNLIMITED, i18n.t('plenty')) : '';
    const gDaily = formatCalculatedText(data?.gemini?.weekly?.dailyBudget, gWk);
    const gDev = formatCalculatedText(data?.gemini?.weekly?.deviation, gWk);

    const cWkRefresh = formatResetTime(data?.claude?.weekly?.resetTime, cWk === UNLIMITED, i18n.t('plenty'));
    const c5hRefresh = cHas5h ? formatResetTime(data?.claude?.fiveHour?.resetTime, c5h === UNLIMITED, i18n.t('plenty')) : '';
    const cDaily = formatCalculatedText(data?.claude?.weekly?.dailyBudget, cWk);
    const cDev = formatCalculatedText(data?.claude?.weekly?.deviation, cWk);

    md.appendMarkdown(i18n.t('tooltip_gemini_header'));
    md.appendMarkdown(i18n.t('tooltip_weekly_limit', { value: fmtPct(gWk), refresh: gWkRefresh }));
    if (gHas5h) {
      md.appendMarkdown(i18n.t('tooltip_five_hour_limit', { value: fmtPct(g5h), refresh: g5hRefresh }));
    }
    md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: gDaily }));
    md.appendMarkdown(i18n.t('tooltip_deviation', { value: gDev }));

    md.appendMarkdown(i18n.t('tooltip_claude_header'));
    md.appendMarkdown(i18n.t('tooltip_weekly_limit', { value: fmtPct(cWk), refresh: cWkRefresh }));
    if (cHas5h) {
      md.appendMarkdown(i18n.t('tooltip_five_hour_limit', { value: fmtPct(c5h), refresh: c5hRefresh }));
    }
    md.appendMarkdown(i18n.t('tooltip_daily_budget', { value: cDaily }));
    md.appendMarkdown(i18n.t('tooltip_deviation', { value: cDev }));

    appendFooter(md);
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
  const availableServers = quotaService.getAvailableServers();
  const items = [
    {
      label: i18n.t('menu_refresh_label'),
      description: i18n.t('menu_refresh_desc'),
      action: 'refresh'
    }
  ];

  if (availableServers && availableServers.length > 1) {
    items.push({
      label: i18n.t('menu_switch_account_label'),
      description: i18n.t('menu_switch_account_desc', { count: availableServers.length }),
      action: 'switchAccount'
    });
  }

  if (quotaService.getBackend() === 'cursor') {
    items.push({
      label: i18n.t('menu_dashboard_label'),
      description: i18n.t('menu_dashboard_desc'),
      action: 'dashboard'
    });
  }

  items.push(
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
  );

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: i18n.t('menu_placeholder')
  });

  if (!selected) return;

  switch (selected.action) {
    case 'refresh':
      await updateStatusBar(true);
      vscode.window.setStatusBarMessage(i18n.t('toast_refresh_done'), 2500);
      break;
    case 'switchAccount':
      await promptSwitchAccount();
      break;
    case 'dashboard':
      await vscode.env.openExternal(vscode.Uri.parse(CURSOR_DASHBOARD_URL));
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
 * 切換選定監控的語言伺服器 / 帳號
 */
async function promptSwitchAccount() {
  const servers = quotaService.getAvailableServers();
  if (!servers || servers.length === 0) {
    vscode.window.showInformationMessage(i18n.t('no_accounts_found'));
    return;
  }

  const selectedPid = quotaService.getSelectedPid();
  const currentPid = quotaService._cachedConnection?.pid;

  const options = [
    {
      label: i18n.t('account_auto_label'),
      description: i18n.t('account_auto_desc'),
      pid: null,
      picked: selectedPid === null
    },
    ...servers.map(s => {
      const isCurrent = s.pid === currentPid;
      const typeTag = s.isMainLs ? `[${i18n.t('account_main_tag')}]` : `[${i18n.t('account_sub_tag')}]`;
      return {
        label: `${s.email} ${typeTag}`,
        description: `PID: ${s.pid} · ${s.name || s.tier}${isCurrent ? ` (${i18n.t('account_current_tag')})` : ''}`,
        pid: s.pid,
        picked: selectedPid === s.pid
      };
    })
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: i18n.t('switch_account_placeholder')
  });

  if (selected) {
    quotaService.selectServer(selected.pid);
    await updateStatusBar(true);
    vscode.window.setStatusBarMessage(i18n.t('account_switched_toast', { target: selected.label }), 2500);
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
