const vscode = require('vscode');
const fsPromises = require('node:fs/promises');
const {
  getGlobalPaths,
  getDirectorySizeBytesAsync,
  collectBrainSessionDirs,
  detectHostIde,
  isCopilotEnvironment,
} = require('./systemService');
const copilotChatService = require('./copilotChatService');

let _cachedBrainStats = null;
let _cachedBrainStatsTime = 0;

function isCursorHost() {
  return detectHostIde().id === 'cursor';
}

/**
 * 是否為 VS Code + Copilot 環境
 *
 * Copilot 的對話儲存架構與 Antigravity / Cursor 完全不同
 * （單檔 jsonl 分散於各個 workspaceStorage/<hash>/chatSessions，而非單一 Brain 目錄），
 * 故統計與清理皆委派給 copilotChatService 專責處理。
 * @returns {boolean}
 */
function isCopilotHost() {
  return isCopilotEnvironment();
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
      : '目前無 Brain 對話紀錄目錄。';
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
    const kindHint = isCursorHost() ? 'Cursor 對話紀錄' : '對話紀錄';

    const confirmButton = `確定清理 (${targets.length} 個紀錄)`;
    const selection = await vscode.window.showWarningMessage(
      `確定要清理超過 ${safeMonths} 個月（約 ${days} 天）前的所有${kindHint}嗎？\n\n共 ${targets.length} 個對話資料夾（預估釋放約 ${targetSizeMB} MB 空間），此操作無法復原。`,
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
};
