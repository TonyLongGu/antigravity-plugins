'use strict';

/**
 * VS Code Copilot Chat 對話索引 (chat.ChatSessionStore.index) 外部讀寫模組
 *
 * 背景與依據（實測 VS Code 1.138 / Node 24.18.1）：
 * - VS Code 於 `state.vscdb` 的 `ItemTable` 以鍵 `chat.ChatSessionStore.index` 保存對話索引。
 * - 索引值格式：`{"version":1,"entries":{"<sessionId>":{ sessionId, title, lastMessageDate, timing, ... }}}`
 * - 儲存位置：
 *   * 有開啟工作區 → `workspaceStorage/<hash>/state.vscdb`（StorageScope.WORKSPACE = 1）
 *   * 無工作區空視窗 → `globalStorage/state.vscdb`（StorageScope.APPLICATION = -1）
 * - 原始碼要點：`ChatSessionStore.internalDeleteSession()` 會「刪檔 + 移除索引項目」；
 *   反之若只刪 jsonl 而不同步索引，歷史清單將殘留無法開啟的幽靈項目（readSession 失敗僅記錄錯誤，不會自我修復）。
 * - 該 DB 為 rollback journal 模式（非 WAL），外部取得寫入鎖可行（需 busy_timeout 容忍競用）。
 */

const fs = require('node:fs');
const path = require('node:path');

/** @type {string} */
const INDEX_KEY = 'chat.ChatSessionStore.index';

/** 備份檔固定後綴（不累積，僅保留最近一次寫入前的狀態） */
const BACKUP_SUFFIX = 'toolbox-bak';

let _sqliteModule = null;
let _sqliteResolved = false;

/**
 * 延遲載入 node:sqlite（VS Code 內建 Node 24 已提供；若環境不支援則整體降級）
 * @returns {typeof import('node:sqlite') | null}
 */
function loadSqlite() {
  if (_sqliteResolved) return _sqliteModule;
  _sqliteResolved = true;
  try {
    // eslint-disable-next-line global-require
    const mod = require('node:sqlite');
    _sqliteModule = mod && typeof mod.DatabaseSync === 'function' ? mod : null;
  } catch {
    _sqliteModule = null;
  }
  return _sqliteModule;
}

/**
 * 目前執行環境是否支援直接讀寫 SQLite（不支援時索引同步自動降級為略過）
 * @returns {boolean}
 */
function isAvailable() {
  return loadSqlite() !== null;
}

/**
 * 將 DB 欄位值統一轉為 Buffer
 * @param {unknown} value
 * @returns {Buffer | null}
 */
function toBuffer(value) {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value), 'utf8');
}

/**
 * 解析索引內容，格式不符時回傳 null
 * @param {Buffer | null} raw
 * @returns {{ version: number, entries: Record<string, any> } | null}
 */
function parseIndex(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw.toString('utf8'));
    if (!data || data.version !== 1) return null;
    if (typeof data.entries !== 'object' || data.entries === null || Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 建立（或覆蓋）DB 備份檔
 * @param {string} dbPath
 * @returns {string | null} 備份檔路徑
 */
function backupDatabase(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return null;
    const backupPath = `${dbPath}.${BACKUP_SUFFIX}`;
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * 讀取指定 DB 的對話索引
 * @param {string} dbPath
 * @returns {{ ok: boolean, reason?: string, entries?: Record<string, any>, dbPath?: string }}
 */
function readIndex(dbPath) {
  const sqlite = loadSqlite();
  if (!sqlite) return { ok: false, reason: 'sqlite-unavailable' };
  if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, reason: 'db-missing' };

  let db = null;
  try {
    db = new sqlite.DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 3000');
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(INDEX_KEY);
    const data = parseIndex(toBuffer(row ? row.value : null));
    if (!data) return { ok: false, reason: 'index-missing' };
    return { ok: true, entries: data.entries, dbPath };
  } catch (err) {
    return { ok: false, reason: `read-failed: ${err.message}` };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

/**
 * 從索引中移除指定 session 項目（僅動索引，不動其他鍵）
 *
 * 注意：VS Code 於記憶體中保有 `indexCache`，外部寫入需重載視窗才會反映；
 * 若期間於 VS Code 內產生新對話，記憶體舊索引可能覆寫本次變更。
 *
 * @param {string} dbPath
 * @param {Iterable<string>} sessionIds
 * @param {{ backup?: boolean }} [options]
 * @returns {{ ok: boolean, removed?: number, backupPath?: string | null, reason?: string }}
 */
function removeIndexEntries(dbPath, sessionIds, options = {}) {
  const sqlite = loadSqlite();
  if (!sqlite) return { ok: false, reason: 'sqlite-unavailable' };
  if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, reason: 'db-missing' };

  const ids = new Set(sessionIds || []);
  if (ids.size === 0) return { ok: true, removed: 0, backupPath: null };

  let db = null;
  try {
    db = new sqlite.DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 3000');
    db.exec('BEGIN IMMEDIATE');

    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(INDEX_KEY);
    const data = parseIndex(toBuffer(row ? row.value : null));
    if (!data) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'index-missing' };
    }

    let removed = 0;
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(data.entries, id)) {
        delete data.entries[id];
        removed++;
      }
    }

    if (removed === 0) {
      db.exec('ROLLBACK');
      return { ok: true, removed: 0, backupPath: null };
    }

    const backupPath = options.backup === false ? null : backupDatabase(dbPath);
    const payload = Buffer.from(JSON.stringify(data), 'utf8');
    db.prepare('INSERT OR REPLACE INTO ItemTable(key, value) VALUES(?, ?)').run(INDEX_KEY, payload);
    db.exec('COMMIT');

    return { ok: true, removed, backupPath };
  } catch (err) {
    try {
      if (db) db.exec('ROLLBACK');
    } catch {}
    return { ok: false, reason: `write-failed: ${err.message}` };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

module.exports = {
  INDEX_KEY,
  BACKUP_SUFFIX,
  isAvailable,
  readIndex,
  removeIndexEntries,
};
