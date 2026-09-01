const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const fsPromises = require('node:fs/promises');
const { getGlobalPaths, getDirectorySizeBytesAsync } = require('./systemService');

let _cachedBrainStats = null;
let _cachedBrainStatsTime = 0;

/**
 * 取得 Brain 對話記憶庫統計資訊 (具備 5 秒快取以保證 UI 極致流暢)
 * @param {boolean} [forceRefresh=false]
 */
async function getBrainStats(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedBrainStats && (now - _cachedBrainStatsTime < 5000)) {
    return _cachedBrainStats;
  }

  const paths = getGlobalPaths();
  const brainDir = paths.brain;

  if (!fs.existsSync(brainDir)) {
    _cachedBrainStats = {
      folderCount: 0,
      totalMB: '0.0',
      path: brainDir,
    };
    _cachedBrainStatsTime = now;
    return _cachedBrainStats;
  }

  try {
    const entries = await fsPromises.readdir(brainDir, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory());
    const totalBytes = await getDirectorySizeBytesAsync(brainDir);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    _cachedBrainStats = {
      folderCount: folders.length,
      totalMB: totalMB,
      path: brainDir,
    };
    _cachedBrainStatsTime = now;
    return _cachedBrainStats;
  } catch (err) {
    return {
      folderCount: 0,
      totalMB: '0.0',
      path: brainDir,
      error: err.message,
    };
  }
}

/**
 * 清理指定月份前的 Brain 歷史對話紀錄（含二次確認）
 * @param {number} months
 * @param {object} [provider]
 */
async function cleanBrainHistory(months = 3, provider = null) {
  const safeMonths = Math.max(2, Math.min(4, parseInt(months, 10) || 3));
  const days = safeMonths * 30;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const paths = getGlobalPaths();
  const brainDir = paths.brain;

  if (!fs.existsSync(brainDir)) {
    const msg = '目前無 Brain 對話紀錄目錄。';
    if (provider && typeof provider.pushToast === 'function') provider.pushToast(msg, 'info');
    else vscode.window.showInformationMessage(msg);
    return false;
  }

  try {
    const entries = await fsPromises.readdir(brainDir, { withFileTypes: true });
    const targets = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(brainDir, entry.name);
        try {
          const stat = await fsPromises.stat(fullPath);
          if (stat.mtimeMs < cutoffMs) {
            const size = await getDirectorySizeBytesAsync(fullPath);
            targets.push({
              name: entry.name,
              path: fullPath,
              mtime: stat.mtime,
              size: size,
            });
          }
        } catch {}
      }
    }

    if (targets.length === 0) {
      const msg = `目前沒有超過 ${safeMonths} 個月（約 ${days} 天）前的對話紀錄需要清理。`;
      if (provider && typeof provider.pushToast === 'function') provider.pushToast(msg, 'info');
      else vscode.window.showInformationMessage(msg);
      return false;
    }

    const totalTargetBytes = targets.reduce((sum, t) => sum + t.size, 0);
    const targetSizeMB = (totalTargetBytes / (1024 * 1024)).toFixed(1);

    const confirmButton = `確定清理 (${targets.length} 個紀錄)`;
    const selection = await vscode.window.showWarningMessage(
      `確定要清理超過 ${safeMonths} 個月（約 ${days} 天）前的所有對話紀錄嗎？\n\n共 ${targets.length} 個對話資料夾（預估釋放約 ${targetSizeMB} MB 空間），此操作無法復原。`,
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

    // 清理成功後立即重置快取，確保 UI 容量與紀錄數即時刷新
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
};
