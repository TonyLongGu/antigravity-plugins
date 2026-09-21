'use strict';

/**
 * VS Code Copilot Chat 對話紀錄服務
 *
 * 儲存架構（實測 VS Code 1.138 + Copilot Chat）：
 * - 每個工作區各自一份：`workspaceStorage/<hash>/chatSessions/<sessionId>.jsonl`
 *   （`<hash>` 為 VS Code 內部工作區識別碼，可由同層 `workspace.json` 反查專案）
 * - 無工作區空視窗：`globalStorage/emptyWindowChatSessions/<sessionId>.jsonl`
 * - 索引：`state.vscdb` 之 `chat.ChatSessionStore.index`
 *   * 工作區對話 → 該 `workspaceStorage/<hash>/state.vscdb`
 *   * 空視窗對話 → `globalStorage/state.vscdb`
 * - 另有 `state.vscdb` 的 `.backup` 由 VS Code 自行維護，本服務不觸碰。
 *
 * 與 Antigravity（單一 `~/.gemini/.../brain` 目錄）最大差異：
 * 對話紀錄是「分散於所有工作區」的，故統計須跨目錄聚合，清理須同步各別索引。
 */

const vscode = require('vscode');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const systemService = require('./systemService');
const chatSessionIndex = require('../lib/chat-session-index');

const EMPTY_WINDOW_DIR_NAME = 'emptyWindowChatSessions';
const STATE_DB_NAME = 'state.vscdb';

/** 統計快取（避免側邊欄頻繁刷新時反覆掃描上千個檔案） */
let _cachedStats = null;
let _cachedStatsTime = 0;
const STATS_TTL_MS = 5000;

/**
 * 取得 workspaceStorage 與 globalStorage 根目錄
 * @returns {{ workspaceRoot: string, globalRoot: string }}
 */
function getStorageRoots() {
  const host = systemService.detectHostIde();
  return {
    workspaceRoot: path.join(host.userSettingsDir, 'workspaceStorage'),
    globalRoot: path.join(host.userSettingsDir, 'globalStorage'),
  };
}

/**
 * 將 VS Code 內部 URI 字串轉為可讀的專案顯示名稱
 * 例：`file:///d%3A/PJ/Ai/ai` → `ai`；`file:///d%3A/PJ/Ai/Global.code-workspace` → `Global`
 * @param {string} uriText
 * @returns {{ fsPath: string, label: string, isWorkspaceFile: boolean }}
 */
function describeWorkspaceUri(uriText) {
  const fallback = { fsPath: '', label: '', isWorkspaceFile: false };
  if (!uriText || typeof uriText !== 'string') return fallback;

  let decoded = uriText;
  try {
    decoded = decodeURIComponent(uriText);
  } catch {}

  let fsPath = decoded;
  try {
    fsPath = vscode.Uri.parse(uriText).fsPath || decoded;
  } catch {}

  const normalized = fsPath.replace(/[\\/]+$/, '');
  const base = path.basename(normalized);
  const isWorkspaceFile = /\.code-workspace$/i.test(base);
  const label = isWorkspaceFile ? base.replace(/\.code-workspace$/i, '') : base;

  return { fsPath: normalized, label, isWorkspaceFile };
}

/**
 * 掃描 `workspaceStorage` 下所有工作區容器
 * @returns {Array<{ hash: string, dir: string, chatDir: string, dbPath: string, label: string, fsPath: string, isWorkspaceFile: boolean }>}
 */
function listWorkspaceContainers() {
  const { workspaceRoot } = getStorageRoots();
  const results = [];
  if (!fs.existsSync(workspaceRoot)) return results;

  let entries = [];
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(workspaceRoot, entry.name);

    // 解析 workspace.json 取得專案對應
    let label = entry.name.slice(0, 8);
    let fsPath = '';
    let isWorkspaceFile = false;
    const workspaceJsonPath = path.join(dir, 'workspace.json');
    try {
      if (fs.existsSync(workspaceJsonPath)) {
        const raw = fs.readFileSync(workspaceJsonPath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        const described = describeWorkspaceUri(parsed.workspace || parsed.folder);
        if (described.label) label = described.label;
        fsPath = described.fsPath;
        isWorkspaceFile = described.isWorkspaceFile;
      }
    } catch {}

    results.push({
      hash: entry.name,
      dir,
      chatDir: path.join(dir, 'chatSessions'),
      dbPath: path.join(dir, STATE_DB_NAME),
      label,
      fsPath,
      isWorkspaceFile,
    });
  }

  return results;
}

/**
 * 收集所有對話紀錄項目（不讀取索引，僅以檔案實體為準以維持掃描效能）
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<Array<object>>}
 */
async function collectSessions(options = {}) {
  const { globalRoot } = getStorageRoots();
  const sessions = [];

  const readSessionFiles = async (chatDir, meta) => {
    let dirents = [];
    try {
      dirents = await fsPromises.readdir(chatDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;
      if (!/\.(jsonl|json)$/i.test(dirent.name)) continue;
      const filePath = path.join(chatDir, dirent.name);
      try {
        const stat = await fsPromises.stat(filePath);
        sessions.push({
          id: path.basename(dirent.name, path.extname(dirent.name)),
          fileName: dirent.name,
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          mtime: stat.mtime,
          scope: meta.scope,
          dbPath: meta.dbPath,
          workspaceHash: meta.workspaceHash,
          projectLabel: meta.projectLabel,
        });
      } catch {}
    }
  };

  // 1. 各工作區的對話
  for (const container of listWorkspaceContainers()) {
    await readSessionFiles(container.chatDir, {
      scope: 'workspace',
      dbPath: container.dbPath,
      workspaceHash: container.hash,
      projectLabel: container.label,
    });
  }

  // 2. 空視窗（未開啟任何資料夾）的對話
  await readSessionFiles(path.join(globalRoot, EMPTY_WINDOW_DIR_NAME), {
    scope: 'emptyWindow',
    dbPath: path.join(globalRoot, STATE_DB_NAME),
    workspaceHash: '',
    projectLabel: '',
  });

  // 3. 轉移中的暫存對話（VS Code 於工作區切換時使用，容量極小但一併計入）
  await readSessionFiles(path.join(globalRoot, 'transferredChatSessions'), {
    scope: 'transferred',
    dbPath: path.join(globalRoot, STATE_DB_NAME),
    workspaceHash: '',
    projectLabel: '',
  });

  return sessions;
}

/**
 * 取得對話記憶庫統計（具備 TTL 快取以保證 UI 流暢）
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<object>}
 */
async function getStats(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedStats && now - _cachedStatsTime < STATS_TTL_MS) {
    return _cachedStats;
  }

  const { workspaceRoot } = getStorageRoots();

  try {
    const sessions = await collectSessions();
    const totalBytes = sessions.reduce((sum, s) => sum + s.sizeBytes, 0);

    // 依工作區分組，供 UI 以 tooltip 呈現明細
    const groupMap = new Map();
    for (const s of sessions) {
      const key = s.scope === 'workspace'
        ? (s.projectLabel || s.workspaceHash.slice(0, 8))
        : (s.scope === 'emptyWindow' ? '∅ (無工作區視窗)' : '⇄ (轉移中)');
      const bucket = groupMap.get(key) || { label: key, count: 0, bytes: 0 };
      bucket.count++;
      bucket.bytes += s.sizeBytes;
      groupMap.set(key, bucket);
    }

    const groups = [...groupMap.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .map((g) => ({ label: g.label, count: g.count, totalMB: (g.bytes / (1024 * 1024)).toFixed(1) }));

    _cachedStats = {
      folderCount: sessions.length,
      totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
      path: workspaceRoot,
      groups,
      indexSyncAvailable: chatSessionIndex.isAvailable(),
      containers: listWorkspaceContainers().length,
    };
    _cachedStatsTime = now;
    return _cachedStats;
  } catch (err) {
    return {
      folderCount: 0,
      totalMB: '0.0',
      path: workspaceRoot,
      groups: [],
      indexSyncAvailable: chatSessionIndex.isAvailable(),
      error: err.message,
    };
  }
}

/**
 * 清理指定月份前的 Copilot 對話紀錄，並同步維護 VS Code 對話索引
 *
 * 流程：二次確認 → 刪除 jsonl/json 檔 → 依 DB 分組移除索引項目 → 提示重載視窗。
 * 索引同步屬「盡力而為」：若環境不支援 node:sqlite 或寫入失敗，檔案仍會刪除，
 * 僅在歷史清單殘留點不開的項目，並於結果中明確告知。
 *
 * @param {number} [months=3]
 * @param {object} [provider]
 * @returns {Promise<boolean>} 是否實際執行刪除
 */
async function cleanHistory(months = 3, provider = null) {
  const safeMonths = Math.max(2, Math.min(4, parseInt(months, 10) || 3));
  const days = safeMonths * 30;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const notify = (message, status) => {
    if (provider && typeof provider.pushToast === 'function') provider.pushToast(message, status);
    else if (status === 'error') vscode.window.showErrorMessage(message);
    else vscode.window.showInformationMessage(message);
  };

  let sessions = [];
  try {
    sessions = await collectSessions();
  } catch (err) {
    notify(`讀取對話紀錄失敗：${err.message}`, 'error');
    return false;
  }

  if (sessions.length === 0) {
    notify('目前沒有任何 Copilot 對話紀錄。', 'info');
    return false;
  }

  const targets = sessions.filter((s) => s.mtimeMs < cutoffMs);

  if (targets.length === 0) {
    notify(`目前沒有超過 ${safeMonths} 個月（約 ${days} 天）前的對話紀錄需要清理。`, 'info');
    return false;
  }

  const totalTargetBytes = targets.reduce((sum, t) => sum + t.sizeBytes, 0);
  const targetSizeMB = (totalTargetBytes / (1024 * 1024)).toFixed(1);
  const affectedProjects = new Set(
    targets.filter((t) => t.scope === 'workspace').map((t) => t.projectLabel || t.workspaceHash.slice(0, 8))
  ).size;

  const confirmButton = `確定清理 (${targets.length} 筆)`;
  const selection = await vscode.window.showWarningMessage(
    `確定要清理超過 ${safeMonths} 個月（約 ${days} 天）前的 Copilot 對話紀錄嗎？\n\n`
    + `共 ${targets.length} 筆對話（涵蓋 ${affectedProjects} 個專案，預估釋放約 ${targetSizeMB} MB 空間），此操作無法復原。\n\n`
    + '清理後會同步更新 VS Code 對話索引，建議清理完成後重載視窗以確保清單一致。',
    { modal: true },
    confirmButton
  );

  if (selection !== confirmButton) return false;

  // ---- 1. 刪除實體檔案 ----
  let deletedCount = 0;
  let freedBytes = 0;
  const deletedIdsByDb = new Map();

  for (const target of targets) {
    try {
      await fsPromises.rm(target.filePath, { force: true });
      deletedCount++;
      freedBytes += target.sizeBytes;

      const bucket = deletedIdsByDb.get(target.dbPath) || new Set();
      bucket.add(target.id);
      deletedIdsByDb.set(target.dbPath, bucket);
    } catch (err) {
      console.error(`刪除對話紀錄失敗 [${target.fileName}]:`, err);
    }
  }

  // ---- 2. 同步對話索引 ----
  let syncedCount = 0;
  const syncFailures = [];
  let backupPath = null;

  if (chatSessionIndex.isAvailable()) {
    for (const [dbPath, ids] of deletedIdsByDb.entries()) {
      const result = chatSessionIndex.removeIndexEntries(dbPath, ids);
      if (result.ok) {
        syncedCount += result.removed || 0;
        if (result.backupPath) backupPath = result.backupPath;
      } else if (result.reason !== 'index-missing' && result.reason !== 'db-missing') {
        syncFailures.push(`${path.basename(path.dirname(dbPath))}: ${result.reason}`);
      }
    }
  }

  _cachedStats = null;
  _cachedStatsTime = 0;

  const freedMB = (freedBytes / (1024 * 1024)).toFixed(1);
  const indexAvailable = chatSessionIndex.isAvailable();

  if (syncFailures.length > 0) {
    const message = `已刪除 ${deletedCount} 筆對話（釋放約 ${freedMB} MB），`
      + `但索引同步部分失敗（已刪除 ${syncedCount} 筆索引項目）：${syncFailures.join('；')}`;
    notify(message, 'warning');
    return true;
  }

  const indexHint = indexAvailable
    ? `已同步移除 ${syncedCount} 筆索引項目，請重載視窗（Developer: Reload Window）以更新對話清單。`
    : '偵測不到內建 SQLite 支援，未同步對話索引；請重載視窗檢查清單是否殘留項目。';

  const successMessage = `已成功清理 ${deletedCount} 筆超過 ${safeMonths} 個月的對話紀錄，共釋放約 ${freedMB} MB！`
    + `\n${indexHint}`
    + (backupPath ? `\n（索引資料庫已備份：${path.basename(backupPath)}）` : '');

  notify(successMessage, 'success');
  return true;
}

module.exports = {
  getStats,
  cleanHistory,
  collectSessions,
  listWorkspaceContainers,
};
