const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACCESS_TOKEN_KEY = 'cursorAuth/accessToken';
const EMAIL_KEY = 'cursorAuth/cachedEmail';
const MEMBERSHIP_KEY = 'cursorAuth/stripeMembershipType';
const SUB_STATUS_KEY = 'cursorAuth/stripeSubscriptionStatus';

/**
 * Cursor 本機認證讀取服務
 * 優先以 node:sqlite 查詢 state.vscdb，避免把數 GB 的資料庫整檔載入。
 */
class AuthService {
  constructor() {
    this._token = null;
    this._account = null;
  }

  clearCache() {
    this._token = null;
    this._account = null;
  }

  /**
   * 取得 Cursor access token（記憶體快取）
   * @param {boolean} forceRefresh
   * @returns {Promise<string|null>}
   */
  async getAccessToken(forceRefresh = false) {
    if (this._token && !forceRefresh) return this._token;
    if (forceRefresh) this._token = null;

    const dbPath = this.getCursorDbPath();
    if (!dbPath) return null;

    const raw = await this._readSqliteValue(dbPath, ACCESS_TOKEN_KEY);
    const token = this._unwrapSqliteText(raw);
    if (token && token.length > 20) {
      this._token = token;
      return token;
    }
    return null;
  }

  /**
   * 取得快取帳號資訊（email / 方案），失敗不阻斷額度查詢
   * @returns {Promise<{email:string, tier:string, status:string, userId:string|null}>}
   */
  async getCachedAccount() {
    if (this._account) return this._account;

    const dbPath = this.getCursorDbPath();
    let email = '';
    let tier = '';
    let status = '';
    if (dbPath) {
      const [emailRaw, tierRaw, statusRaw] = await Promise.all([
        this._readSqliteValue(dbPath, EMAIL_KEY),
        this._readSqliteValue(dbPath, MEMBERSHIP_KEY),
        this._readSqliteValue(dbPath, SUB_STATUS_KEY)
      ]);
      email = this._unwrapSqliteText(emailRaw) || '';
      tier = this._unwrapSqliteText(tierRaw) || '';
      status = this._unwrapSqliteText(statusRaw) || '';
    }

    this._account = {
      email,
      tier,
      status,
      userId: this._findUserId()
    };
    return this._account;
  }

  /**
   * Cursor 使用者資料根目錄清單（依平台推導，不寫死磁碟代號）
   * @returns {string[]}
   */
  getCursorUserDataRoots() {
    const home = os.homedir();
    const roots = [];
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      roots.push(path.join(appData, 'Cursor'));
    } else if (process.platform === 'darwin') {
      roots.push(path.join(home, 'Library', 'Application Support', 'Cursor'));
    } else {
      roots.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor'));
    }
    roots.push(path.join(home, '.cursor'));
    return roots;
  }

  /**
   * 取得 state.vscdb 路徑
   * @returns {string|null}
   */
  getCursorDbPath() {
    for (const root of this.getCursorUserDataRoots()) {
      const dbPath = path.join(root, 'User', 'globalStorage', 'state.vscdb');
      if (fs.existsSync(dbPath)) return dbPath;
    }
    return null;
  }

  _findUserId() {
    for (const root of this.getCursorUserDataRoots()) {
      const files = [
        path.join(root, 'sentry', 'scope_v3.json'),
        path.join(root, 'sentry', 'session.json')
      ];
      for (const file of files) {
        try {
          if (!fs.existsSync(file)) continue;
          const text = fs.readFileSync(file, 'utf8');
          const match = text.match(/user_[a-zA-Z0-9]{20,}/);
          if (match) return match[0];
        } catch (_) { /* 忽略單一檔案讀取失敗 */ }
      }
    }
    return null;
  }

  _unwrapSqliteText(value) {
    if (value == null) return null;
    let text = String(value).trim();
    if (!text) return null;
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('{') && text.endsWith('}'))) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string') text = parsed;
      } catch (_) { /* 非 JSON 字串則原樣使用 */ }
    }
    return text;
  }

  /**
   * 讀取 ItemTable 單一鍵：in-process sqlite → 系統 node 子行程 → Python → 串流掃描
   * @private
   */
  async _readSqliteValue(dbPath, key) {
    const fromNative = this._readWithNodeSqlite(dbPath, key);
    if (fromNative != null) return fromNative;

    const fromChild = await this._readWithSpawnedNode(dbPath, key);
    if (fromChild != null) return fromChild;

    if (key === ACCESS_TOKEN_KEY) {
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        const fromWal = this._scanJwtNearKey(walPath, key);
        if (fromWal) return fromWal;
      }
      return this._scanJwtNearKey(dbPath, key);
    }
    return null;
  }

  _readWithNodeSqlite(dbPath, key) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
        return row && row.value != null ? String(row.value) : null;
      } finally {
        db.close();
      }
    } catch (_) {
      return null;
    }
  }

  _readWithSpawnedNode(dbPath, key) {
    const helper = path.join(__dirname, '..', 'lib', 'read-vscdb-value.js');
    const nodeCmds = this._candidateNodeCommands();
    return this._tryExecQueue(nodeCmds.map((cmd) => ({
      cmd,
      args: [helper, dbPath, key]
    })));
  }

  _candidateNodeCommands() {
    const cmds = [];
    const local = process.env.LOCALAPPDATA;
    const pf = process.env.ProgramFiles;
    if (local) cmds.push(path.join(local, 'Programs', 'nodejs', 'node.exe'));
    if (pf) cmds.push(path.join(pf, 'nodejs', 'node.exe'));
    cmds.push(process.platform === 'win32' ? 'node.exe' : 'node');
    return cmds;
  }

  _tryExecQueue(jobs) {
    return new Promise((resolve) => {
      const next = (index) => {
        if (index >= jobs.length) {
          resolve(null);
          return;
        }
        const job = jobs[index];
        execFile(job.cmd, job.args, {
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 1024 * 1024
        }, (err, stdout) => {
          if (!err) {
            const text = String(stdout || '').trim();
            if (text) {
              resolve(text);
              return;
            }
          }
          next(index + 1);
        });
      };
      next(0);
    });
  }

  /**
   * 最後手段：在 SQLite 檔案中掃描鍵名附近的 JWT（不整檔載入）
   * @private
   */
  _scanJwtNearKey(dbPath, key) {
    try {
      const fd = fs.openSync(dbPath, 'r');
      try {
        const needle = Buffer.from(key, 'utf8');
        const stat = fs.fstatSync(fd);
        const maxScanBytes = 64 * 1024 * 1024;
        if (stat.size > maxScanBytes) return null;
        const chunkSize = 4 * 1024 * 1024;
        const overlap = needle.length + 4096;
        let offset = 0;
        let prevTail = Buffer.alloc(0);

        while (offset < stat.size) {
          const len = Math.min(chunkSize, stat.size - offset);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, offset);
          const view = Buffer.concat([prevTail, buf]);
          let from = 0;
          while (from <= view.length - needle.length) {
            const idx = view.indexOf(needle, from);
            if (idx < 0) break;
            const window = view.subarray(Math.max(0, idx - 64), Math.min(view.length, idx + needle.length + 2048));
            const jwt = this._extractJwt(window.toString('latin1'));
            if (jwt) return jwt;
            from = idx + needle.length;
          }
          prevTail = view.subarray(Math.max(0, view.length - overlap));
          offset += len;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) { /* 掃描失敗則放棄 */ }
    return null;
  }

  _extractJwt(text) {
    const match = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    return match ? match[0] : null;
  }
}

module.exports = new AuthService();
