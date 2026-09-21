const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalPath } = require('./systemService');
const { SKILL_SUB_PATHS, getDefaultGlobalSkillsDir, syncWorkspaceSkills } = require('../lib/skill-junction-sync');

const SETTING_KEY = 'syncSkillsOnFolderToggle';
const WATCH_DEBOUNCE_MS = 400;

function getGlobalSkillsDir() {
  return getDefaultGlobalSkillsDir();
}

function isSyncEnabled() {
  return !!vscode.workspace.getConfiguration('antigravity').get(SETTING_KEY, false);
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
        `Skills 同步完成：新增 ${result.added}、解除 ${result.removed}、失敗 ${result.failed}`,
        `Skills synced: added ${result.added}, removed ${result.removed}, failed ${result.failed}`
      ),
      'warning'
    );
    return;
  }

  if (result.added > 0 || result.removed > 0) {
    provider.pushToast(
      toastText(
        `Skills 同步完成：新增 ${result.added}、解除 ${result.removed}（Codex / Cline）`,
        `Skills synced: added ${result.added}, removed ${result.removed} (Codex / Cline)`
      ),
      'success'
    );
    return;
  }

  if (force) {
    provider.pushToast(
      toastText(
        `Skills 已對齊目前啟用專案，無需變更（${result.kept} 個連結）`,
        `Skills already match enabled projects (${result.kept} links)`
      ),
      'info'
    );
  }
}

function syncEnabledProjectSkills(enabledFolders, wsDir, provider = null, options = {}) {
  const { notify = false, force = false } = options;
  if (!force && !isSyncEnabled()) return null;
  lastProvider = provider || lastProvider;

  const result = syncWorkspaceSkills(enabledFolders, wsDir, {
    globalDir: getGlobalSkillsDir(),
  });
  notifySyncResult(result, provider, { notify, force });
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

  for (const folder of enabledFolders || []) {
    const projFull = getCanonicalPath(folder.path || '', wsDir);
    if (!projFull || !fs.existsSync(projFull)) continue;

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
 * 開啟：立即依啟用專案對齊並開始跟隨。
 * 關閉：停止跟隨，保留現有連結。
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
  if (provider?.pushToast) {
    provider.pushToast(
      toastText(
        '已停止跟隨 Skills 變更，現有連結保留。',
        'Stopped following Skills changes. Existing links are kept.'
      ),
      'info'
    );
  }
}

module.exports = {
  SETTING_KEY,
  getGlobalSkillsDir,
  isSyncEnabled,
  isSyncWriteInFlight,
  syncEnabledProjectSkills,
  setSyncEnabled,
  refreshSkillSync,
  bindSkillSync,
  syncWatchersToSetting,
  refreshSkillWatchers,
  disposeSkillWatchers,
};
