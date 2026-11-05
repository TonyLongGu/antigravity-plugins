const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalPath } = require('./systemService');
const { SKILL_SUB_PATHS, getDefaultGlobalSkillsDir, syncWorkspaceSkills, clearGlobalSkillLinks } = require('../lib/skill-junction-sync');

const SETTING_KEY = 'syncSkillsOnFolderToggle';
const EXCLUDE_FIRST_SETTING_KEY = 'skillSyncExcludeFirstProject';
const WATCH_DEBOUNCE_MS = 400;

function getGlobalSkillsDir() {
  return getDefaultGlobalSkillsDir();
}

function isSyncEnabled() {
  return !!vscode.workspace.getConfiguration('antigravity').get(SETTING_KEY, false);
}

/**
 * 「排除首專案（面板清單排序第 1 個專案）」開關狀態
 */
function isExcludeFirstProjectEnabled() {
  return !!vscode.workspace.getConfiguration('antigravity').get(EXCLUDE_FIRST_SETTING_KEY, false);
}

let syncWriteInFlight = false;
let extensionContext = null;
let lastProvider = null;
let watchDebounce = null;
let skillWatchers = [];
// 工作區資料夾增減／工作區檔被改寫後的延遲對齊，以及「剛剛才由面板同步過」的時間戳（避免重複 toast）
let alignDebounce = null;
let lastPanelSyncAt = 0;
const WORKSPACE_ALIGN_DEBOUNCE_MS = 700;
const PANEL_SYNC_QUIET_MS = 1500;
let watchersBoundToContext = false;

function isSyncWriteInFlight() {
  return syncWriteInFlight;
}

function isEnglishLocale() {
  return vscode.workspace.getConfiguration('antigravity').get('locale', 'zh-TW') === 'en';
}

function toastText(zh, en) {
  return isEnglishLocale() ? en : zh;
}

/**
 * 取得需排除於同步來源的專案路徑（目前僅「首專案」= 面板專案清單排序第 1 個）
 * @returns {string[]} 完整路徑陣列；未開啟排除時為空陣列
 */
function resolveExcludedProjectPaths() {
  if (!isExcludeFirstProjectEnabled()) return [];
  try {
    const workspaceService = require('./workspaceService');
    const firstPath = workspaceService.getFirstProjectFullPath();
    return firstPath ? [firstPath] : [];
  } catch (err) {
    console.error('解析首專案排除路徑失敗:', err);
    return [];
  }
}

/**
 * 取得目前工作區「註冊過的所有專案路徑」（啟用 folders ＋ 停用 disabledFolders）
 * 用來判定全域連結的歸屬；沒有開啟 .code-workspace 時回傳 null。
 * @returns {string[]|null}
 */
function getWorkspaceOwnershipPaths() {
  try {
    const workspaceService = require('./workspaceService');
    const ctx = workspaceService.loadWorkspaceContext();
    if (!ctx?.json) return null;
    const active = Array.isArray(ctx.json.folders) ? ctx.json.folders : [];
    const disabled = Array.isArray(ctx.json.disabledFolders) ? ctx.json.disabledFolders : [];
    return [...active, ...disabled].map((f) => f?.path || '').filter(Boolean);
  } catch (err) {
    console.error('解析工作區專案歸屬範圍失敗:', err);
    return null;
  }
}

/**
 * 決定本次同步的「歸屬範圍」：
 *  - workspacePaths：本工作區註冊過的所有專案（啟用＋停用），用於判斷全域連結是否屬於本工作區
 *  - allowEmpty：folders 為空是否代表「所有專案都關掉了」的權威狀態（是 → 應解除本工作區的連結）
 * 呼叫端可明確傳入；未傳時自動向目前的工作區設定檔查詢。
 * @param {Array<{path?: string}>} enabledFolders
 * @param {{ workspacePaths?: string[], allowEmpty?: boolean }} [options]
 * @returns {{ workspacePaths?: string[], allowEmpty: boolean }}
 */
function resolveSyncScope(enabledFolders, options = {}) {
  let workspacePaths = Array.isArray(options.workspacePaths) ? options.workspacePaths : null;
  let allowEmpty = typeof options.allowEmpty === 'boolean' ? options.allowEmpty : null;

  if (workspacePaths === null || allowEmpty === null) {
    const ownershipPaths = getWorkspaceOwnershipPaths();
    if (ownershipPaths) {
      if (workspacePaths === null) workspacePaths = ownershipPaths;
      if (allowEmpty === null) allowEmpty = true;
    }
  }

  // 沒有工作區設定檔時，至少用目前傳入的啟用專案當歸屬範圍
  if (workspacePaths === null && Array.isArray(enabledFolders) && enabledFolders.length > 0) {
    workspacePaths = enabledFolders.map((f) => f?.path || '').filter(Boolean);
  }

  return {
    ...(workspacePaths ? { workspacePaths } : {}),
    allowEmpty: allowEmpty === true,
  };
}

/**
 * 產生排除首專案的提示後綴文字
 * @param {object} result
 */
function excludedSuffix(result) {
  const names = Array.isArray(result?.excludedProjects) ? result.excludedProjects : [];
  if (names.length === 0) return '';
  return toastText(
    `（已排除首專案：${names.join('、')}）`,
    ` (excluded first project: ${names.join(', ')})`
  );
}

function notifySyncResult(result, provider, options = {}) {
  if (!provider?.pushToast || !result) return;
  const { notify = false, force = false } = options;
  if (!notify) return;

  if (result.skipped === 'empty-enabled') {
    provider.pushToast(
      toastText(
        '目前沒有啟用中的專案，已略過 Skills 同步（不會清除既有連結）。',
        'No enabled projects; skipped Skills sync (existing links kept).'
      ),
      'warning'
    );
    return;
  }

  if (result.failed > 0) {
    provider.pushToast(
      toastText(
        `Skills 同步完成：新增 ${result.added}、解除 ${result.removed}、失敗 ${result.failed}${excludedSuffix(result)}`,
        `Skills synced: added ${result.added}, removed ${result.removed}, failed ${result.failed}${excludedSuffix(result)}`
      ),
      'warning'
    );
    return;
  }

  if (result.added > 0 || result.removed > 0) {
    provider.pushToast(
      toastText(
        `Skills 同步完成：新增 ${result.added}、解除 ${result.removed}（Codex / Cline）${excludedSuffix(result)}`,
        `Skills synced: added ${result.added}, removed ${result.removed} (Codex / Cline)${excludedSuffix(result)}`
      ),
      'success'
    );
    return;
  }

  if (force) {
    provider.pushToast(
      toastText(
        `Skills 已對齊目前啟用專案，無需變更（${result.kept} 個連結）${excludedSuffix(result)}`,
        `Skills already match enabled projects (${result.kept} links)${excludedSuffix(result)}`
      ),
      'info'
    );
  }
}

/**
 * 依啟用專案對齊全域 Skills Junction（開啟「排除首專案」時，首專案不列入來源）
 * @param {Array<{path?: string, name?: string}>} enabledFolders
 * @param {string} wsDir
 * @param {object} [provider]
 * @param {{ notify?: boolean, force?: boolean, workspacePaths?: string[], allowEmpty?: boolean, reclaimAll?: boolean }} [options]
 *   - workspacePaths / allowEmpty：連結歸屬範圍（見 resolveSyncScope）；未提供時自動查詢目前工作區
 *   - reclaimAll：忽略歸屬範圍、把全域目錄內所有連結視為本工作區所有（僅手動「重新對齊」使用）
 */
function syncEnabledProjectSkills(enabledFolders, wsDir, provider = null, options = {}) {
  const { notify = false, force = false } = options;
  if (!force && !isSyncEnabled()) return null;
  lastProvider = provider || lastProvider;
  // 面板操作（force）剛剛同步過：記錄時間，讓隨之而來的「工作區變更」事件不要重複同步／重複 toast
  if (force) lastPanelSyncAt = Date.now();

  const result = syncWorkspaceSkills(enabledFolders, wsDir, {
    globalDir: getGlobalSkillsDir(),
    excludePaths: resolveExcludedProjectPaths(),
    reclaimAll: options.reclaimAll === true,
    ...resolveSyncScope(enabledFolders, options),
  });
  notifySyncResult(result, provider, { notify, force });
  return result;
}

/**
 * 解除全域 Skills 目錄下所有由同步建立的連結（Junction / Symlink）
 * 僅移除連結本身，實體資料夾（使用者自建技能）一律保留。
 * @param {object} [provider]
 * @param {{ notify?: boolean }} [options]
 * @returns {{ removed: number, kept: number, failed: number, globalDir: string, removedNames: string[] }}
 */
function clearSyncedSkills(provider = null, options = {}) {
  const { notify = false } = options;
  lastProvider = provider || lastProvider;

  const result = clearGlobalSkillLinks({ globalDir: getGlobalSkillsDir() });

  if (notify && provider?.pushToast) {
    if (result.failed > 0) {
      provider.pushToast(
        toastText(
          `已解除 ${result.removed} 個全域 Skills 連結，${result.failed} 個解除失敗（實體資料夾未動）。`,
          `Removed ${result.removed} global Skills links, ${result.failed} failed (real folders untouched).`
        ),
        'warning'
      );
    } else if (result.removed > 0) {
      provider.pushToast(
        toastText(
          `已解除 ${result.removed} 個全域 Skills 連結（實體資料夾保留）。`,
          `Removed ${result.removed} global Skills links (real folders kept).`
        ),
        'success'
      );
    } else {
      provider.pushToast(
        toastText(
          '全域 Skills 目錄沒有可解除的連結，已保持原狀。',
          'No global Skills links to remove; nothing changed.'
        ),
        'info'
      );
    }
  }

  return result;
}

function disposeSkillWatchers() {
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
  if (alignDebounce) {
    clearTimeout(alignDebounce);
    alignDebounce = null;
  }
  for (const watcher of skillWatchers) {
    try { watcher.dispose(); } catch {}
  }
  skillWatchers = [];
}

function scheduleWatchSync() {
  if (!isSyncEnabled()) return;
  if (watchDebounce) clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => {
    watchDebounce = null;
    if (!isSyncEnabled()) return;
    const workspaceService = require('./workspaceService');
    const ctx = workspaceService.loadWorkspaceContext(lastProvider, true);
    if (!ctx) return;
    syncEnabledProjectSkills(ctx.json.folders, ctx.wsDir, lastProvider, { notify: false });
  }, WATCH_DEBOUNCE_MS);
}

function refreshSkillWatchers(enabledFolders, wsDir) {
  disposeSkillWatchers();
  if (!isSyncEnabled() || !extensionContext) return;

  if (!enabledFolders || !wsDir) {
    const workspaceService = require('./workspaceService');
    const ctx = workspaceService.loadWorkspaceContext();
    if (!ctx) return;
    enabledFolders = ctx.json.folders;
    wsDir = ctx.wsDir;
  }

  const globs = SKILL_SUB_PATHS.flatMap((sub) => {
    const posix = sub.split(path.sep).join('/');
    return [posix, `${posix}/*`];
  });

  // 排除首專案：其 Skills 變更不會影響全域連結，故不需建立監看
  const excludedCanon = new Set(
    resolveExcludedProjectPaths().map((p) => getCanonicalPath(p).toLowerCase())
  );

  for (const folder of enabledFolders || []) {
    const projFull = getCanonicalPath(folder.path || '', wsDir);
    if (!projFull || !fs.existsSync(projFull)) continue;
    if (excludedCanon.has(projFull.toLowerCase())) continue;

    const base = vscode.Uri.file(projFull);
    for (const glob of globs) {
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(base, glob)
        );
        watcher.onDidCreate(scheduleWatchSync);
        watcher.onDidDelete(scheduleWatchSync);
        watcher.onDidChange(scheduleWatchSync);
        skillWatchers.push(watcher);
      } catch {}
    }
  }
}

function bindSkillSync(context) {
  extensionContext = context;
  if (!watchersBoundToContext) {
    watchersBoundToContext = true;
    context.subscriptions.push({ dispose: disposeSkillWatchers });
  }
  syncWatchersToSetting();
}

function syncWatchersToSetting() {
  if (isSyncEnabled()) {
    refreshSkillWatchers();
  } else {
    disposeSkillWatchers();
  }
}

/**
 * 使用者手動按「重新對齊 Skills 連結」：以目前工作區為權威，把全域 Skills 目錄整理成
 * 「只有本工作區啟用專案（且未被排除）的技能」。
 *
 * 為什麼要 reclaimAll（2026-11-04 修正）：舊版沿用自動同步的「連結歸屬」判定，只回收
 * 「目標落在本工作區已註冊專案內」或「目標已失效」的連結。專案一旦被整個從工作區移除
 * （面板拖出即移除、或手動刪掉 `folders`／`disabledFolders` 的項目），它的目標就不在任何
 * 註冊路徑內 ⇒ 永遠認不出來、按幾次重新整理都留著（使用者回報的殘留）。
 * 手動按下這顆按鈕語意是「以目前工作區為準」，故改為權威模式；自動觸發的同步不受影響。
 * @param {object} [provider]
 * @param {Array<{path?: string, name?: string}>} [enabledFolders]
 * @param {string} [wsDir]
 */
function refreshSkillSync(provider = null, enabledFolders = [], wsDir = '') {
  lastProvider = provider || lastProvider;
  // 2026-11-05：同步關閉時按 ↻ 不得反向「對齊」——舊版因為 force 繞過開關檢查，
  // 會把剛關閉時解除的連結全部重建，使用者看到的就是「關了又長回來」。
  // 關閉狀態下 ↻ 的語意改為「維持關閉」：只解除、不建立。
  if (!isSyncEnabled()) {
    disposeSkillWatchers();
    clearSyncedSkills(provider, { notify: true });
    return;
  }
  syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true, reclaimAll: true });
  refreshSkillWatchers(enabledFolders, wsDir);
}

/**
 * 設定由外部變更（settings.json 或其他視窗）時套用新狀態：
 * 開啟 → 重整監看；關閉 → 停止監看並解除所有全域連結。
 * @param {object} [provider]
 * @returns {object|null} 關閉時回傳解除結果
 */
function applySyncSettingChange(provider = null) {
  lastProvider = provider || lastProvider;
  if (isSyncEnabled()) {
    syncWatchersToSetting();
    return null;
  }
  disposeSkillWatchers();
  return clearSyncedSkills(provider, { notify: true });
}

/**
 * 開啟：立即依啟用專案對齊並開始跟隨。
 * 關閉：停止跟隨，並解除所有指向全域 Skills 目錄的連結（實體資料夾保留）。
 */
async function setSyncEnabled(enabled, provider = null, enabledFolders = [], wsDir = '') {
  lastProvider = provider;
  const config = vscode.workspace.getConfiguration('antigravity');
  const target = vscode.workspace.workspaceFile
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  syncWriteInFlight = true;
  let writeError = null;
  try {
    await config.update(SETTING_KEY, enabled, target);
  } catch (err) {
    // 2026-11-05：舊版把寫入失敗往外丟 ⇒ 下面「關閉 ⇒ 解除連結」整段被跳過，
    // 面板卻已樂觀顯示關閉（settings.json 唯讀、工作區檔不可寫時就是這個症狀）。
    writeError = err;
  } finally {
    setTimeout(() => {
      syncWriteInFlight = false;
    }, 400);
  }

  // 不論設定是否寫入成功，都套用使用者這次的意圖；失敗只額外提示，不讓動作靜默消失。
  if (writeError) {
    console.error('寫入 Skills 同步設定失敗:', writeError);
    if (provider?.pushToast) {
      provider.pushToast(
        toastText(
          `同步設定寫入失敗（${writeError.message || writeError}）；本次仍會直接${enabled ? '建立' : '解除'}連結。`,
          `Failed to persist the sync setting (${writeError.message || writeError}); applying this ${enabled ? 'enable' : 'disable'} action anyway.`
        ),
        'warning'
      );
    }
  }

  if (enabled) {
    // 使用者主動開啟同步＝以目前工作區為準（含清掉已移除專案的孤兒連結）
    syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true, reclaimAll: true });
    refreshSkillWatchers(enabledFolders, wsDir);
    return;
  }

  disposeSkillWatchers();
  clearSyncedSkills(provider, { notify: true });
}

/**
 * 設定「排除首專案」開關（首專案不列入同步來源，其既有連結會一併解除）
 * @param {boolean} enabled
 * @param {object} [provider]
 * @param {Array} [enabledFolders]
 * @param {string} [wsDir]
 */
async function setExcludeFirstProject(enabled, provider = null, enabledFolders = [], wsDir = '') {
  lastProvider = provider;
  const config = vscode.workspace.getConfiguration('antigravity');
  const target = vscode.workspace.workspaceFile
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  syncWriteInFlight = true;
  try {
    await config.update(EXCLUDE_FIRST_SETTING_KEY, enabled, target);
  } finally {
    setTimeout(() => {
      syncWriteInFlight = false;
    }, 400);
  }

  // 僅在主要同步開關已開啟時才立即重新對齊，避免關閉狀態下被動觸發同步
  if (isSyncEnabled()) {
    // 使用者切換面板開關＝以目前工作區為準（首專案的連結必須解除，孤兒連結一併回收）
    syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true, reclaimAll: true });
    refreshSkillWatchers(enabledFolders, wsDir);
    return;
  }

  if (provider?.pushToast) {
    provider.pushToast(
      toastText(
        enabled
          ? '已開啟「排除首專案」，待開啟 Skills 同步後生效。'
          : '已關閉「排除首專案」。',
        enabled
          ? 'Exclude first project enabled; it takes effect once Skills sync is on.'
          : 'Exclude first project disabled.'
      ),
      'info'
    );
  }
}

/**
 * 以「目前工作區」為權威立即對齊一次（不做防抖、不判斷 quiet window）。
 * 用於：VS Code 原生「將資料夾加入工作區／從工作區移除」、.code-workspace 被改寫之後。
 * @param {object} [provider]
 * @param {{ notify?: boolean }} [options]
 * @returns {object|null} 同步結果；沒有工作區檔或同步未開啟時回 null
 */
function alignWorkspaceSkillsNow(provider = null, options = {}) {
  if (!isSyncEnabled()) return null;
  lastProvider = provider || lastProvider;
  const workspaceService = require('./workspaceService');
  const ctx = workspaceService.loadWorkspaceContext(provider, true);
  if (!ctx) return null;

  const result = syncEnabledProjectSkills(
    ctx.json.folders,
    ctx.wsDir,
    provider,
    { notify: options.notify !== false, force: true, reclaimAll: true }
  );
  refreshSkillWatchers(ctx.json.folders, ctx.wsDir);
  return result;
}

/**
 * 工作區「資料夾增減」或工作區檔被改寫時，延遲對齊一次（防抖）。
 *
 * 為什麼要 quiet window：面板自己動完專案開關就會同步一次（且已有 toast），
 * 而那個寫檔／VS Code 重讀資料夾又會再觸發本函式 ⇒ 不加防護會多一次同步與重複提示。
 * 只有在「最近 PANEL_SYNC_QUIET_MS 內沒有面板同步」時才真的執行，
 * 也就是真正來自 VS Code 原生加入／移除資料夾或外部改寫工作區檔的情況。
 * @param {object} [provider]
 * @param {number} [delay]
 */
function scheduleWorkspaceAlign(provider = null, delay = WORKSPACE_ALIGN_DEBOUNCE_MS) {
  if (!isSyncEnabled()) return;
  lastProvider = provider || lastProvider;
  if (alignDebounce) clearTimeout(alignDebounce);
  alignDebounce = setTimeout(() => {
    alignDebounce = null;
    if (!isSyncEnabled()) return;
    if (Date.now() - lastPanelSyncAt < PANEL_SYNC_QUIET_MS) return;
    alignWorkspaceSkillsNow(lastProvider, { notify: true });
  }, delay);
}

module.exports = {
  SETTING_KEY,
  EXCLUDE_FIRST_SETTING_KEY,
  getGlobalSkillsDir,
  isSyncEnabled,
  isExcludeFirstProjectEnabled,
  isSyncWriteInFlight,
  syncEnabledProjectSkills,
  clearSyncedSkills,
  applySyncSettingChange,
  setSyncEnabled,
  setExcludeFirstProject,
  refreshSkillSync,
  alignWorkspaceSkillsNow,
  scheduleWorkspaceAlign,
  bindSkillSync,
  syncWatchersToSetting,
  refreshSkillWatchers,
  disposeSkillWatchers,
};
