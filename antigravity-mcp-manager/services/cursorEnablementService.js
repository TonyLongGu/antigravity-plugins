// ==============================================================================
// 檔案名稱：services/cursorEnablementService.js
// 功能說明：讀取 Cursor Customize 的 MCP 停用清單（state.vscdb）
// 鍵名：
//   全域  cursor/disabledGlobalMcpServers  → ["user-comfyui", ...]
//   工作區 cursor/disabledMcpServers
// 不寫入資料庫；僅供儀表板顯示高光與啟用數。
// ==============================================================================

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = { env: { appRoot: '' } };
}
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const GLOBAL_DISABLED_KEY = 'cursor/disabledGlobalMcpServers';
const WORKSPACE_DISABLED_KEY = 'cursor/disabledMcpServers';
const SCAN_SIZE_LIMIT = 8 * 1024 * 1024;

class CursorEnablementService {
  static context = null;
  static lastDisabledNames = new Set();

  static init(context) {
    this.context = context || null;
  }

  static getGlobalStateDbPath() {
    const gs = this.context?.globalStorageUri?.fsPath;
    if (gs) return path.join(gs, '..', 'state.vscdb');
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    return '';
  }

  static getWorkspaceStateDbPath() {
    const ws = this.context?.storageUri?.fsPath;
    if (ws) return path.join(ws, '..', 'state.vscdb');
    return '';
  }

  static toServerName(id) {
    if (typeof id !== 'string' || !id) return '';
    if (id.startsWith('user-')) return id.slice(5);
    const colon = id.lastIndexOf(':');
    if (colon >= 0 && colon < id.length - 1) {
      try {
        return decodeURIComponent(id.slice(colon + 1));
      } catch {
        return id.slice(colon + 1);
      }
    }
    return id;
  }

  static decodeValue(val) {
    if (val == null) return [];
    if (Buffer.isBuffer(val)) val = val.toString('utf8');
    if (typeof val !== 'string') val = String(val);
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  static extractJsonArrayAfterKey(buf, key) {
    const needle = Buffer.from(key, 'utf8');
    let from = 0;
    let last = null;
    while (from < buf.length) {
      const idx = buf.indexOf(needle, from);
      if (idx < 0) break;
      let i = idx + needle.length;
      const max = Math.min(buf.length, i + 40);
      while (i < max && buf[i] !== 0x5b) i++;
      if (i < buf.length && buf[i] === 0x5b) {
        const slice = buf.slice(i, Math.min(buf.length, i + 16384)).toString('utf8');
        const end = slice.indexOf(']');
        if (end >= 0) {
          try {
            const parsed = JSON.parse(slice.slice(0, end + 1));
            if (Array.isArray(parsed)) last = parsed.filter((item) => typeof item === 'string');
          } catch (_) {}
        }
      }
      from = idx + 1;
    }
    return last;
  }

  static tryNodeSqliteGet(dbPath, key) {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      return null;
    }
    if (typeof DatabaseSync !== 'function') return null;
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
      return this.decodeValue(row ? row.value : []);
    } catch (err) {
      console.warn(`node:sqlite 讀取失敗 [${key}]:`, err.message);
      return null;
    } finally {
      try {
        db && db.close();
      } catch (_) {}
    }
  }

  static loadAppSqlite3() {
    const appRoot = vscode?.env?.appRoot;
    if (!appRoot) return null;
    try {
      return require(path.join(appRoot, 'node_modules', '@vscode', 'sqlite3'));
    } catch {
      return null;
    }
  }

  static readKeyWithAppSqlite3(dbPath, key) {
    const sqlite3 = this.loadAppSqlite3();
    if (!sqlite3 || !sqlite3.Database) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
        if (openErr) {
          console.warn(`@vscode/sqlite3 開啟失敗:`, openErr.message);
          return finish(null);
        }
        db.get('SELECT value FROM ItemTable WHERE key = ?', [key], (err, row) => {
          db.close();
          if (err) {
            console.warn(`@vscode/sqlite3 讀取失敗 [${key}]:`, err.message);
            return finish(null);
          }
          finish(this.decodeValue(row ? row.value : []));
        });
      });
    });
  }

  static async readKeyByScan(dbPath, key) {
    const candidates = [dbPath, `${dbPath}-wal`];
    let last = null;
    for (const filePath of candidates) {
      try {
        const st = await fsPromises.stat(filePath);
        if (st.size > SCAN_SIZE_LIMIT) continue;
        const buf = await fsPromises.readFile(filePath);
        const parsed = this.extractJsonArrayAfterKey(buf, key);
        if (parsed) last = parsed;
      } catch (_) {}
    }
    return last;
  }

  static async readKey(dbPath, key) {
    if (!dbPath || !fs.existsSync(dbPath)) return [];
    const viaNode = this.tryNodeSqliteGet(dbPath, key);
    if (viaNode !== null) return viaNode;
    const viaApp = await this.readKeyWithAppSqlite3(dbPath, key);
    if (viaApp !== null) return viaApp;
    const viaScan = await this.readKeyByScan(dbPath, key);
    if (viaScan !== null) return viaScan;
    return undefined;
  }

  /**
   * 回傳目前被 Customize 停用的伺服器名稱（不含 user- 前綴）
   * @returns {Promise<Set<string>>}
   */
  static async getDisabledServerNames() {
    const names = new Set();
    const globalDb = this.getGlobalStateDbPath();
    const workspaceDb = this.getWorkspaceStateDbPath();
    const [globalIds, workspaceIds] = await Promise.all([
      globalDb ? this.readKey(globalDb, GLOBAL_DISABLED_KEY) : Promise.resolve([]),
      workspaceDb ? this.readKey(workspaceDb, WORKSPACE_DISABLED_KEY) : Promise.resolve([]),
    ]);
    if (globalIds === undefined) {
      const fallback = new Set(this.lastDisabledNames);
      for (const id of workspaceIds || []) {
        const name = this.toServerName(id);
        if (name) fallback.add(name);
      }
      return fallback;
    }
    for (const id of [...globalIds, ...(workspaceIds || [])]) {
      const name = this.toServerName(id);
      if (name) names.add(name);
    }
    this.lastDisabledNames = names;
    return names;
  }
}

module.exports = CursorEnablementService;
