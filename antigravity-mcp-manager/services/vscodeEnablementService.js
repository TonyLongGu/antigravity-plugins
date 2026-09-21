// ==============================================================================
// 檔案名稱：services/vscodeEnablementService.js
// 功能說明：讀取 Visual Studio Code Copilot 的 MCP 啟停狀態（mcp.enablement）
// 定位：純檢視（唯讀），與 cursorEnablementService 對等
// 依據原始碼：src/vs/workbench/contrib/chat/common/enablement.ts
//   EnablementModel('mcp.enablement') → StorageScope.PROFILE / StorageScope.WORKSPACE
//   值格式：JSON.stringify([...Map<伺服器識別碼, boolean>])
//   語意：false = 停用、true = 明確啟用、不存在 = 預設啟用（工作區覆寫優先於全域）
// 伺服器識別碼規則（src/vs/workbench/services/mcp/common/mcpWorkbenchManagementService.ts）
//   使用者 mcp.json        → mcp.config.usrlocal.<name>
//   遠端使用者 mcp.json    → mcp.config.usrremote.<name>
//   工作區資料夾 .vscode/mcp.json → mcp.config.ws<folderIndex>.<name>
//   工作區 .code-workspace → mcp.config.workspace.<name>
//   工作區根 .mcp.json     → workspace-dot-mcp.<folderIndex>.<name>
//   擴充套件提供           → <publisher>.<ext>/<label>
// ==============================================================================

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const ENABLEMENT_KEY = 'mcp.enablement';
const SCAN_SIZE_LIMIT = 8 * 1024 * 1024;

// 伺服器識別碼前綴（僅列出實際參與比對者，避免留下無人使用的常數）
//   usrlocal        → 使用者 mcp.json
//   ws<idx>         → 工作區 .vscode/mcp.json
//   workspace-dot-mcp.<idx> → 工作區根 .mcp.json（Claude 風格）
const ID_USER = 'mcp.config.usrlocal';
const ID_WORKSPACE_FOLDER = 'mcp.config.ws';
const ID_WORKSPACE_ROOT_FILE = 'workspace-dot-mcp';

// 開關狀態（語意層）
const OVERRIDE_INHERIT = 'inherit';
const OVERRIDE_ON = 'on';
const OVERRIDE_OFF = 'off';

class VscodeEnablementService {
  static context = null;
  // 上次成功讀取的對照表（讀取失敗時墊檔，避免狀態閃爍）
  static lastProfileMap = null;
  static lastWorkspaceMap = null;

  static init(context) {
    this.context = context || null;
  }

  // ── 路徑解析 ────────────────────────────────────────────────────────────────
  // VS Code 實際目錄結構（已於本機實測驗證，勿憑直覺推測）：
  //   context.globalStorageUri = {userData}\User\globalStorage\{publisher}.{extId}
  //   context.storageUri       = {workspaceStorage}\{hash}\{publisher}.{extId}
  // 因此：
  //   退「一」層 = 共用儲存根（globalStorage，state.vscdb 所在）
  //   退「兩」層 = 使用者設定目錄（mcp.json 所在）
  // 同套件 antigravity-toolbox/services/systemService.js 採相同慣例：
  //   // {userData}/User/globalStorage/{extId} → User
  //   path.normalize(path.join(ext.globalStorageUri.fsPath, '..', '..'))

  /** 共用儲存根目錄（含 state.vscdb）；同時容忍不含擴充子目錄的舊版結構 */
  static get storageRootDir() {
    const gs = this.context?.globalStorageUri?.fsPath;
    if (gs) {
      const parent = path.dirname(gs);
      return path.basename(parent).toLowerCase() === 'globalstorage' ? parent : gs;
    }
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, 'Code', 'User', 'globalStorage') : '';
  }

  /** 使用者設定目錄（mcp.json 所在；具名設定檔為 {userData}\User\profiles\<id>） */
  static get profileDir() {
    const root = this.storageRootDir;
    return root ? path.dirname(root) : '';
  }

  static get profileDbPath() {
    const root = this.storageRootDir;
    return root ? path.join(root, 'state.vscdb') : '';
  }

  static get workspaceDbPath() {
    const ws = this.context?.storageUri?.fsPath;
    if (!ws) return '';
    // 舊版無擴充子目錄時 state.vscdb 直接位於 storageUri 之下
    const direct = path.join(ws, 'state.vscdb');
    if (fs.existsSync(direct)) return direct;
    return path.resolve(ws, '..', 'state.vscdb');
  }

  // ── 識別碼工具 ─────────────────────────────────────────────────────────────

  /**
   * 建立伺服器識別碼
   * @param {'user'|'workspace'|'workspaceRoot'} source
   */
  static buildServerId(name, source, workspaceFolderIndex = 0) {
    if (source === 'workspaceRoot') return `${ID_WORKSPACE_ROOT_FILE}.${workspaceFolderIndex}.${name}`;
    if (source === 'workspace') return `${ID_WORKSPACE_FOLDER}${workspaceFolderIndex}.${name}`;
    return `${ID_USER}.${name}`;
  }

  /** 在既有對照表中找出該伺服器實際使用的識別碼（避免自建錯誤 id） */
  static resolveServerId(map, name, fallbackId) {
    if (!map || !name) return fallbackId;
    if (map.has(fallbackId)) return fallbackId;

    // 僅在「同一個 scope 前綴」內做後綴比對。
    // 否則工作區伺服器（mcp.config.ws0.foo）會誤配到同名的使用者伺服器（mcp.config.usrlocal.foo），
    // 使其狀態被另一個 scope 的資料牽動。
    const lastDot = fallbackId.lastIndexOf('.');
    const prefix = lastDot > 0 ? fallbackId.slice(0, lastDot) : '';
    const suffix = `.${name}`;
    const slashSuffix = `/${name}`;
    for (const key of map.keys()) {
      if (prefix && !key.startsWith(`${prefix}.`)) continue;
      if (key.endsWith(suffix) || key.endsWith(slashSuffix)) return key;
    }
    return fallbackId;
  }

  // ── 讀取 ───────────────────────────────────────────────────────────────────

  static decodeValue(val) {
    if (val == null) return null;
    if (Buffer.isBuffer(val)) val = val.toString('utf8');
    if (typeof val !== 'string') val = String(val);
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) return null;
      return new Map(parsed.filter((e) => Array.isArray(e) && typeof e[0] === 'string'));
    } catch {
      return null;
    }
  }

  static extractJsonArrayAfterKey(buf, key) {
    const needle = Buffer.from(`"${key}"`, 'utf8');
    const idx = buf.indexOf(needle);
    if (idx < 0) return null;
    let i = idx + needle.length;
    const limit = Math.min(buf.length, i + 64);
    while (i < limit && buf[i] !== 0x5b) i++;
    if (i >= buf.length || buf[i] !== 0x5b) return null;
    const slice = buf.slice(i, Math.min(buf.length, i + 262144)).toString('utf8');
    const end = slice.lastIndexOf(']');
    if (end < 0) return null;
    try {
      const parsed = JSON.parse(slice.slice(0, end + 1));
      if (!Array.isArray(parsed)) return null;
      return new Map(parsed.filter((e) => Array.isArray(e) && typeof e[0] === 'string'));
    } catch {
      return null;
    }
  }

  /**
   * 以 node:sqlite 讀取
   * @returns {Map|null|undefined} Map = 讀到資料；null = 檔案正常但無此 key；undefined = 讀取失敗
   */
  static readMapBySqlite(dbPath) {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      return undefined;
    }
    if (typeof DatabaseSync !== 'function') return undefined;
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 1000');
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(ENABLEMENT_KEY);
      return this.decodeValue(row ? row.value : null);
    } catch (err) {
      console.warn(`[MCP] node:sqlite 讀取失敗：${err.message}`);
      return undefined;
    } finally {
      try {
        db && db.close();
      } catch (_) {}
    }
  }

  /**
   * 掃描檔頭找 key（讀取失敗時的備援）
   * @returns {Map|undefined} undefined 代表確實找不到
   */
  static async readMapByScan(dbPath) {
    for (const filePath of [dbPath, `${dbPath}-wal`]) {
      try {
        const st = await fsPromises.stat(filePath);
        if (st.size > SCAN_SIZE_LIMIT) continue;
        const buf = await fsPromises.readFile(filePath);
        const parsed = this.extractJsonArrayAfterKey(buf, ENABLEMENT_KEY);
        if (parsed) return parsed;
      } catch (_) {}
    }
    return undefined;
  }

  /**
   * 讀取指定 DB 的啟停對照表
   * @returns {Promise<{ok: boolean, map: Map|null}>}
   *   ok=false 表示讀取失敗（呼叫端應沿用上次成功的值，勿誤判為「全部啟用」）
   */
  static async readMap(dbPath) {
    // 尚未建立 DB = 從未調整過開關 = 全部預設啟用，屬於有效狀態
    if (!dbPath || !fs.existsSync(dbPath)) return { ok: true, map: null };

    const viaSqlite = this.readMapBySqlite(dbPath);
    if (viaSqlite !== undefined) return { ok: true, map: viaSqlite };

    const viaScan = await this.readMapByScan(dbPath);
    if (viaScan !== undefined) return { ok: true, map: viaScan };

    return { ok: false, map: null };
  }

  /**
   * 取得兩座 DB 的變更簽章（僅 stat，成本極低）
   * 供輪詢判斷「是否需要重新解析」，避免每輪都開啟 SQLite
   * @returns {string}
   */
  static dbSignature() {
    const parts = [];
    for (const dbPath of [this.profileDbPath, this.workspaceDbPath]) {
      if (!dbPath) {
        parts.push('-');
        continue;
      }
      // 兩者皆納入簽章：任一變動都要能被偵測（涵蓋 WAL 模式）
      const segs = [];
      for (const filePath of [dbPath, `${dbPath}-wal`]) {
        try {
          const st = fs.statSync(filePath);
          segs.push(`${st.mtimeMs}:${st.size}`);
        } catch (_) {
          segs.push('x');
        }
      }
      parts.push(segs.join('+'));
    }
    return parts.join('|');
  }

  /**
   * 讀取全域（Profile）與工作區兩層狀態
   * 讀取失敗時沿用上次成功的值，避免暫時性 SQLITE_BUSY 讓面板瞬間全部翻成啟用
   * @returns {Promise<{profile: Map|null, workspace: Map|null, profileDb: string, workspaceDb: string, stale: boolean}>}
   */
  static async readState() {
    const profileDb = this.profileDbPath;
    const workspaceDb = this.workspaceDbPath;
    const [profileResult, workspaceResult] = await Promise.all([
      this.readMap(profileDb),
      workspaceDb ? this.readMap(workspaceDb) : Promise.resolve({ ok: true, map: null }),
    ]);

    let stale = false;

    if (profileResult.ok) {
      this.lastProfileMap = profileResult.map;
    } else {
      stale = true;
    }

    if (workspaceResult.ok) {
      this.lastWorkspaceMap = workspaceResult.map;
    } else {
      stale = this.lastWorkspaceMap !== null || stale;
    }

    return {
      profile: profileResult.ok ? profileResult.map : this.lastProfileMap,
      workspace: workspaceResult.ok ? workspaceResult.map : this.lastWorkspaceMap,
      profileDb,
      workspaceDb,
      stale,
    };
  }

  /**
   * 解析單一伺服器的完整狀態
   * @param {object} state readState() 的結果
   * @param {string} name 伺服器名稱
   * @param {'user'|'workspace'|'workspaceRoot'} source 來源
   * @param {number} workspaceFolderIndex
   */
  static resolve(state, name, source, workspaceFolderIndex = 0) {
    const fallbackId = this.buildServerId(name, source, workspaceFolderIndex);
    const profileId = this.resolveServerId(state.profile, name, fallbackId);
    const workspaceId = this.resolveServerId(state.workspace, name, fallbackId);

    const profileEnabled = state.profile && state.profile.has(profileId) ? state.profile.get(profileId) === true : true;
    const hasWorkspaceOverride = !!(state.workspace && state.workspace.has(workspaceId));
    const workspaceEnabled = hasWorkspaceOverride ? state.workspace.get(workspaceId) === true : profileEnabled;

    const override = !hasWorkspaceOverride ? OVERRIDE_INHERIT : workspaceEnabled ? OVERRIDE_ON : OVERRIDE_OFF;

    return {
      // 工作區層（含根 .mcp.json）的伺服器以工作區識別碼為代表，其餘為使用者識別碼
      id: source === 'user' ? profileId : workspaceId,
      profileId,
      workspaceId,
      profileEnabled,
      hasWorkspaceOverride,
      workspaceEnabled,
      workspaceOverride: override,
      effectiveEnabled: hasWorkspaceOverride ? workspaceEnabled : profileEnabled,
    };
  }

  // ── 寫入 ───────────────────────────────────────────────────────────────────
  //
  // 本服務僅供讀取。
  //
  // 原本曾實作直接寫入 state.vscdb 的能力，但該路徑有兩項無法消除的缺點：
  //   1. mcp.enablement 於視窗載入時即讀入記憶體，寫入後必須重載視窗才生效，
  //      且重載前若於 VS Code 內再切換開關，會被整份舊 map 覆寫。
  //   2. 屬未公開內部機制，格式若變動將無聲失效。
  // 因此改為與 Cursor 一致的純檢視模式：顯示真實狀態、探測、備註。
  // ───────────────────────────────────────────────────────────────────────────
}

module.exports = VscodeEnablementService;
module.exports.OVERRIDE_INHERIT = OVERRIDE_INHERIT;
module.exports.OVERRIDE_ON = OVERRIDE_ON;
module.exports.OVERRIDE_OFF = OVERRIDE_OFF;
