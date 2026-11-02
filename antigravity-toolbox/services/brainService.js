const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const fsPromises = require('node:fs/promises');
const {
  getGlobalPaths,
  getDirectorySizeBytesAsync,
  collectBrainSessionDirs,
  resolveFlavor,
} = require('./systemService');
const copilotChatService = require('./copilotChatService');

let _cachedBrainStats = null;
let _cachedBrainStatsTime = 0;

function isCursorHost() {
  return resolveFlavor() === 'cursor';
}

/** 目前是否採用 Cline 資料類別（Cline 的對話為 ~/.cline/data/sessions/<id> 資料夾） */
function isClineHost() {
  return resolveFlavor() === 'cline';
}

/** 目前是否採用 Kilo 資料類別（7.x 的對話在 kilo.db，只有舊版 tasks/<id> 是資料夾） */
function isKiloHost() {
  return resolveFlavor() === 'kilo';
}

/**
 * 目前是否採用 Copilot 資料類別
 *
 * auto 時代表「VS Code 家族 + GitHub Copilot」環境；使用者亦可透過
 * antigravity.uiFlavor 手動切換，此時一律以指定類別為準。
 *
 * Copilot 的對話儲存架構與 Antigravity / Cursor 完全不同
 * （單檔 jsonl 分散於各個 workspaceStorage/<hash>/chatSessions，而非單一 Brain 目錄），
 * 故統計與清理皆委派給 copilotChatService 專責處理。
 * @returns {boolean}
 */
function isCopilotHost() {
  return resolveFlavor() === 'copilot';
}

/**
 * 清除統計快取。
 * 切換資料來源類別（antigravity.uiFlavor）後必須呼叫，否則 5 秒內會回放舊類別的數據。
 */
function invalidateCache() {
  _cachedBrainStats = null;
  _cachedBrainStatsTime = 0;
}

/**
 * 統計 Kilo 的對話數與資料佔用。
 *
 * Kilo 7.x 的對話在 `~/.local/share/kilo/kilo.db`（SQLite），沒有「一個資料夾＝一筆對話」可數：
 *   1. 優先以 `node:sqlite` 唯讀查詢 `session` 表（Node 22.13+ / 新版 VS Code 相容宿主）
 *   2. 環境不支援時退回 `storage/session_share/*.json` 的檔案數（Kilo 每筆對話一份）
 * 佔用空間則取整個資料家目錄（kilo.db、storage、snapshot…），對應卡片「開啟」的位置。
 * @returns {Promise<{folderCount:number,totalMB:string,path:string}>}
 */
async function getKiloBrainStats() {
  const dataHome = getGlobalPaths('kilo').appData;
  const totalBytes = await getDirectorySizeBytesAsync(dataHome);
  let sessionCount = 0;

  try {
    const dbPath = path.join(dataHome, 'kilo.db');
    if (fs.existsSync(dbPath)) {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare('SELECT COUNT(*) AS count FROM session').get();
        sessionCount = Number(row && row.count) || 0;
      } finally {
        db.close();
      }
    }
  } catch {}

  if (!sessionCount) {
    try {
      const shareDir = path.join(dataHome, 'storage', 'session_share');
      sessionCount = fs.readdirSync(shareDir).filter((name) => name.endsWith('.json')).length;
    } catch {}
  }

  return {
    folderCount: sessionCount,
    totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
    path: dataHome,
  };
}

/**
 * 取得對話記憶庫統計資訊 (具備 5 秒快取以保證 UI 極致流暢)
 * @param {boolean} [forceRefresh=false]
 */
async function getBrainStats(forceRefresh = false) {
  if (isCopilotHost()) {
    return copilotChatService.getStats(forceRefresh);
  }

  const now = Date.now();
  if (!forceRefresh && _cachedBrainStats && (now - _cachedBrainStatsTime < 5000)) {
    return _cachedBrainStats;
  }

  if (isKiloHost()) {
    const stats = await getKiloBrainStats();
    _cachedBrainStats = stats;
    _cachedBrainStatsTime = now;
    return stats;
  }

  const paths = getGlobalPaths();
  const sessions = collectBrainSessionDirs();

  if (sessions.length === 0) {
    _cachedBrainStats = {
      folderCount: 0,
      totalMB: '0.0',
      path: paths.brain,
    };
    _cachedBrainStatsTime = now;
    return _cachedBrainStats;
  }

  try {
    const sizes = await Promise.all(sessions.map((dir) => getDirectorySizeBytesAsync(dir)));
    const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    _cachedBrainStats = {
      folderCount: sessions.length,
      totalMB,
      path: paths.brain,
    };
    _cachedBrainStatsTime = now;
    return _cachedBrainStats;
  } catch (err) {
    return {
      folderCount: 0,
      totalMB: '0.0',
      path: paths.brain,
      error: err.message,
    };
  }
}

/**
 * 清理指定月份前的歷史對話紀錄（含二次確認）
 * @param {number} months
 * @param {object} [provider]
 */
async function cleanBrainHistory(months = 3, provider = null) {
  if (isCopilotHost()) {
    return copilotChatService.cleanHistory(months, provider);
  }

  const safeMonths = Math.max(2, Math.min(4, parseInt(months, 10) || 3));
  const days = safeMonths * 30;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = collectBrainSessionDirs();

  if (sessions.length === 0) {
    const msg = isCursorHost()
      ? '目前沒有 Cursor 對話紀錄（agent-transcripts）。'
      : (isClineHost()
        ? '目前沒有 Cline 對話紀錄（~/.cline/data/sessions）。'
        : (isKiloHost()
          ? '目前沒有資料夾型 Kilo 對話紀錄；Kilo 7.x 的對話存在 ~/.local/share/kilo/kilo.db（SQLite），請用 Kilo 內建功能刪除。'
          : '目前無 Brain 對話紀錄目錄。'));
    if (provider && typeof provider.pushToast === 'function') provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  try {
    const targets = [];

    for (const fullPath of sessions) {
      try {
        const stat = await fsPromises.stat(fullPath);
        if (stat.mtimeMs < cutoffMs) {
          const size = await getDirectorySizeBytesAsync(fullPath);
          targets.push({
            name: fullPath,
            path: fullPath,
            mtime: stat.mtime,
            size,
          });
        }
      } catch {}
    }

    if (targets.length === 0) {
      const msg = `目前沒有超過 ${safeMonths} 個月（約 ${days} 天）前的對話紀錄需要清理。`;
      if (provider && typeof provider.pushToast === 'function') provider.pushToast(msg, 'info');
      else vscode.window.showInformationMessage(msg);
      return false;
    }

    const totalTargetBytes = targets.reduce((sum, t) => sum + t.size, 0);
    const targetSizeMB = (totalTargetBytes / (1024 * 1024)).toFixed(1);
    const kindHint = isCursorHost()
      ? 'Cursor 對話紀錄'
      : (isClineHost() ? 'Cline 對話紀錄' : (isKiloHost() ? 'Kilo 對話紀錄（舊版資料夾）' : '對話紀錄'));
    // Cline 另有 SQLite 索引（data/db/sessions.db、session-search.db），本工具只刪資料夾、
    // 不動資料庫，因此清理後 Cline 介面可能仍列出已刪除的項目——務必在確認視窗講清楚。
    // Kilo 同理：7.x 的對話本體在 kilo.db，本工具只回收舊版 tasks/<id>/ 資料夾。
    const dbNote = isClineHost()
      ? '\n\n⚠️ 本工具只刪除 sessions 資料夾，不會同步 Cline 的 SQLite 索引（sessions.db／session-search.db），清理後 Cline 介面可能仍列出已刪除的對話。'
      : (isKiloHost()
        ? '\n\n⚠️ 本工具只刪除舊版 tasks 資料夾，不會同步 Kilo 的 kilo.db（SQLite）；清理後 Kilo 介面可能仍列出已刪除的對話。'
        : '');

    const confirmButton = `確定清理 (${targets.length} 個紀錄)`;
    const selection = await vscode.window.showWarningMessage(
      `確定要清理超過 ${safeMonths} 個月（約 ${days} 天）前的所有${kindHint}嗎？\n\n共 ${targets.length} 個對話資料夾（預估釋放約 ${targetSizeMB} MB 空間），此操作無法復原。${dbNote}`,
      { modal: true },
      confirmButton
    );

    if (selection !== confirmButton) {
      return false;
    }

    let deletedCount = 0;
    let freedBytes = 0;

    for (const t of targets) {
      try {
        await fsPromises.rm(t.path, { recursive: true, force: true });
        deletedCount++;
        freedBytes += t.size;
      } catch (err) {
        console.error(`刪除對話紀錄失敗 [${t.name}]:`, err);
      }
    }

    _cachedBrainStats = null;
    _cachedBrainStatsTime = 0;

    const freedMB = (freedBytes / (1024 * 1024)).toFixed(1);
    const successMsg = `已成功清理 ${deletedCount} 個超過 ${safeMonths} 個月的對話紀錄，共釋放約 ${freedMB} MB 空間！`;
    if (provider && typeof provider.pushToast === 'function') provider.pushToast(successMsg, 'success');
    else vscode.window.showInformationMessage(successMsg);
    return true;
  } catch (err) {
    const errMsg = `清理對話紀錄失敗：${err.message}`;
    if (provider && typeof provider.pushToast === 'function') provider.pushToast(errMsg, 'error');
    else vscode.window.showErrorMessage(errMsg);
    return false;
  }
}

module.exports = {
  getBrainStats,
  cleanBrainHistory,
  invalidateCache,
};
