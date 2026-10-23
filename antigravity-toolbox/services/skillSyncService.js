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
 * @param {{ notify?: boolean, force?: boolean }} [options]
 */
function syncEnabledProjectSkills(enabledFolders, wsDir, provider = null, options = {}) {
  const { notify = false, force = false } = options;
  if (!force && !isSyncEnabled()) return null;
  lastProvider = provider || lastProvider;

  const result = syncWorkspaceSkills(enabledFolders, wsDir, {
    globalDir: getGlobalSkillsDir(),
    excludePaths: resolveExcludedProjectPaths(),
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

function refreshSkillSync(provider = null, enabledFolders = [], wsDir = '') {
  lastProvider = provider || lastProvider;
  syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true });
  if (isSyncEnabled()) {
    refreshSkillWatchers(enabledFolders, wsDir);
  }
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
  try {
    await config.update(SETTING_KEY, enabled, target);
  } finally {
    setTimeout(() => {
      syncWriteInFlight = false;
    }, 400);
  }

  if (enabled) {
    syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true });
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
    syncEnabledProjectSkills(enabledFolders, wsDir, provider, { notify: true, force: true });
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
  bindSkillSync,
  syncWatchersToSetting,
  refreshSkillWatchers,
  disposeSkillWatchers,
};
